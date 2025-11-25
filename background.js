// background.js

console.log("PIT Abuse Reporter background loaded");


// ============================================================
// FUNZIONE: ripulisce il blocco header secondo l'algoritmo B
// ============================================================
function cleanHeadersBlock(block) {
    const lines = block.split(/\r?\n/);
    let out = [];
    let skip = 0;

    for (let i = 0; i < lines.length; i++) {

        if (skip > 0) {
            if (/^[ \t]/.test(lines[i])) {
                continue;
            } else {
                skip = 0;
            }
        }

        let line = lines[i];

        if (/^x-/i.test(line)) {

            const noValue = /^x-[^:]+:\s*$/i.test(line);

            if (noValue && i + 1 < lines.length) {
                i++;
            }

            skip = 1;
            continue;
        }

        out.push(line);
    }

    return out.join("\r\n").trimEnd() + "\r\n";
}
// =====================================================================
// FUNZIONE ROBUSTA: Ricava indirizzo abuse tramite DMARC
// - Google DNS (primary)
// - Cloudflare DNS (fallback)
// - Unisce frammenti TXT, gestisce record multipli, multipli mailto, cleanup
// =====================================================================

// --- Cache minimale anti-richieste duplicate ---
const dmarcCache = new Map();

function normalizeDomain(domain) {
    return domain.replace(/^\*\./, "").trim().toLowerCase();
}

function cleanTxtRecord(txt) {
    return txt
        .replace(/^"|"$/g, "")
        .replace(/\s+/g, "")
        .replace(/MS=[^;]+;?/ig, "")   // rimuove MS=... artificial DMARC fragments
        .replace(/v=spf1[^;]+;?/ig, ""); // elimina SPF incollati per errore
}


async function dnsQueryGoogle(name) {
    const url = `https://dns.google/resolve?name=${name}&type=TXT`;
    let resp = await fetch(url);
    if (!resp.ok) throw new Error("Google DNS error");
    return await resp.json();
}

async function dnsQueryCloudflare(name) {
    const url = `https://cloudflare-dns.com/dns-query?name=${name}&type=TXT`;
    let resp = await fetch(url, {
        headers: { "Accept": "application/dns-json" }
    });
    if (!resp.ok) throw new Error("Cloudflare DNS error");
    return await resp.json();
}

function extractDmarcEmailFromRecords(txtRecords) {
    if (!txtRecords || txtRecords.length === 0)
        return null;

    // Unisci i frammenti e rimuovi spazi
    const dmarcJoined = txtRecords.join("").replace(/\s+/g, "");

    // Cerca rua=mailto:... oppure ruf=mailto:...
    const rua = dmarcJoined.match(/rua=mailto:([^;]+)/i);
    const ruf = dmarcJoined.match(/ruf=mailto:([^;]+)/i);

    let target = rua ? rua[1] : (ruf ? ruf[1] : null);
    if (!target) return null;

    // Divide indirizzi multipli
    let mails = target.split(",").map(m => m.trim());

    // Ripulisce mailto:
    mails = mails.map(m => m.replace(/^mailto:/i, ""));

    // Regex email reale (ESCLUDE wildcard e pattern strani)
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    let valid = mails.filter(m => emailRegex.test(m));

    if (valid.length === 0) {
        console.warn("DMARC email rejected:", mails);
        return null;
    }

    return valid[0];
}



async function getAbuseAddr(domain) {
    domain = normalizeDomain(domain);

    if (dmarcCache.has(domain))
        return dmarcCache.get(domain);

    const qname = `_dmarc.${domain}`;

    async function tryResolver(resolverFn, label) {
        try {
            const data = await resolverFn(qname);
            if (!data.Answer) return null;

            const txtRecords = data.Answer
                .filter(a => a.type === 16)
                .map(a => cleanTxtRecord(a.data));

            const mail = extractDmarcEmailFromRecords(txtRecords);

            if (mail) {
                console.log(`DMARC abuse (${label}):`, mail);
                return mail;
            }
        } catch (e) {
            console.warn(`${label} DNS failed:`, e);
        }
        return null;
    }

    // Google first
    let mail = await tryResolver(dnsQueryGoogle, "Google");

    // Cloudflare fallback
    if (!mail)
        mail = await tryResolver(dnsQueryCloudflare, "Cloudflare");

    // Last fallback
    if (!mail) {
        mail = "abuse@" + domain;
        console.warn("DMARC lookup failed for both resolvers → fallback");
    }

    dmarcCache.set(domain, mail);
    return mail;
}


// ============================================================
// MAIN LOGIC — CREAZIONE DELLA MAIL DI ABUSE
// ============================================================

browser.runtime.onMessage.addListener(async (req) => {
    if (req.action !== "abuseReport") return;

    try {
        let msg = await browser.messages.get(req.msgId);

        let fullRaw = await browser.messages.getRaw(msg.id);

        let split = fullRaw.split(/\r?\n\r?\n/);
        let rawHeaderPart = split[0];
        let rawBodyPart   = split.slice(1).join("\r\n\r\n");

        // --- Ripulisci header ---
        let cleanedHeaderPart = cleanHeadersBlock(rawHeaderPart);

        // --- Ricostruisci raw allegato ---
        let cleanedRaw = cleanedHeaderPart + "\r\n" + rawBodyPart;

        // --- Headers strutturati ---
        let full = await browser.messages.getFull(msg.id);
        let headers = full.headers;


        // -------- TROVA abuse domain ----------
        let abuseDomain = "";

        if (headers["x-original-authentication-results"]) {
            let ar = headers["x-original-authentication-results"][0];
            let m = ar.match(/mailfrom=([^;\s]+)/i);
            if (m) abuseDomain = m[1].split("@")[1];
        }

        if (!abuseDomain && headers["return-path"]) {
            let rp = headers["return-path"][0];
            let m = rp.match(/@([^>]+)>?/);
            if (m) abuseDomain = m[1];
        }

        if (!abuseDomain && headers["from"]) {
            let m = headers["from"][0].match(/@([^>]+)>?/);
            if (m) abuseDomain = m[1];
        }

        //let abuseAddr = "abuse@" + abuseDomain;
        //let abuseAddr = await getAbuseAddr(abuseDomain);
        // --- Leggi preferenza globale ---
        let pref = await browser.storage.local.get("useDMARC");
        let useDMARC = pref.useDMARC ?? true;

        let abuseAddr = "";

        if (useDMARC) {
            abuseAddr = await getAbuseAddr(abuseDomain);
        } else {
            abuseAddr = "abuse@" + abuseDomain;
            console.log("Using generic abuse@ fallback (DMARC disabled)");
        }




        // ======================================================
        //  **CORPO HTML MIGLIORATO**
        //  Arial → pre monospace → Arial
        // ======================================================
        let bodyHTML = `
<div style="font-family: sans-serif; font-size: 14px;">
    We received an unsolicited email. Please investigate.<br><br>

    Raw headers:<br>

    <pre style="font-family: monospace; font-size: 13px; white-space: pre-wrap; background:#f7f7f7; padding:10px; border-radius:4px;">
${cleanedHeaderPart.replace(/</g, "&lt;")}
    </pre>

    <br>
    Thank you.<br><br><br>
    <span style="font-size: 11px; color:#666;">
        Abuse created by PIT Abuse Reporter on Thunderbird
    </span>
</div>
`;



        // -----------------------------------------------------
        // Allegato .eml
        // -----------------------------------------------------
        let file = new File([cleanedRaw], "original.eml", {
            type: "message/rfc822"
        });

        let attachment = { file };


        // -----------------------------------------------------
        // Identità corretta
        // -----------------------------------------------------
        let account = await browser.accounts.get(msg.folder.accountId);

        let identityId = account.identities[0].id;
        let targetEmail = headers["to"] ? headers["to"][0].toLowerCase() : "";

        for (let ident of account.identities) {
            if (targetEmail.includes(ident.email.toLowerCase())) {
                identityId = ident.id;
                break;
            }
        }


        // -----------------------------------------------------
        // CREA compose
        // -----------------------------------------------------
        let create = await browser.compose.beginNew({
            to: [abuseAddr],
            subject: "Abuse report",
            body: bodyHTML,
            attachments: [attachment]
        });


        // -----------------------------------------------------
        // Imposta identity DOPO (fix TB140)
        // -----------------------------------------------------
        await browser.compose.setComposeDetails(create.id, {
            identityId: identityId
        });

        console.log("Compose created with identity:", identityId);

    } catch (e) {
        console.error("AbuseReporter ERROR:", e);
    }
});


browser.runtime.onInstalled.addListener(async () => {
    let st = await browser.storage.local.get("useDMARC");

    // Se il valore NON esiste, lo creiamo con il default TRUE
    if (st.useDMARC === undefined) {
        await browser.storage.local.set({ useDMARC: true });
        console.log("PIT Abuse Reporter: default useDMARC = true");
    }
});
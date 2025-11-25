// popup.js

document.addEventListener("DOMContentLoaded", async () => {
    const chk = document.getElementById("useDMARC");

    // Carica preferenza
    let st = await browser.storage.local.get("useDMARC");
    chk.checked = st.useDMARC ?? true; // default: true

    // Aggiorna preferenza se cliccata
    chk.addEventListener("change", async () => {
        await browser.storage.local.set({ useDMARC: chk.checked });
        console.log("useDMARC set to", chk.checked);
    });

    // Pulsanti
    document.getElementById("send").addEventListener("click", async () => {
        let tabs = await browser.mailTabs.query({ active: true, currentWindow: true });
        let tab = tabs[0];
        let msg = await browser.messageDisplay.getDisplayedMessage(tab.id);

        browser.runtime.sendMessage({
            action: "abuseReport",
            msgId: msg.id
        });

        window.close();
    });

    document.getElementById("cancel").addEventListener("click", () => {
        window.close();
    });
});

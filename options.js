document.addEventListener("DOMContentLoaded", async () => {
    console.log("Options page JS loaded");

    const box = document.getElementById("useDMARC");

    // Leggi preferenza
    try {
        const st = await browser.storage.local.get("useDMARC");
        console.log("useDMARC read:", st.useDMARC);
        box.checked = st.useDMARC ?? true;
    } catch (e) {
        console.error("Error reading useDMARC:", e);
    }

    // Salva preferenza
    box.addEventListener("change", async () => {
        try {
            await browser.storage.local.set({ useDMARC: box.checked });
            console.log("useDMARC saved:", box.checked);
        } catch (e) {
            console.error("Error saving useDMARC:", e);
        }
    });
});

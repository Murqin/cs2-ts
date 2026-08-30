// A menu: a list of choices for one player, in chat or in the centre of the screen,
// with a callback per choice. Like a timer it belongs to this script — a reload closes
// it — and there is one per player.

command("!gun", (player: Player | null): void => {
    if (player === null) {
        return;
    }

    menu.open(player, {
        title: "Pick a rifle",
        items: [
            { text: "AK-47", onSelect: (p) => p.sendChat("you took an AK-47") },
            { text: "M4A1-S", onSelect: (p) => p.sendChat("you took an M4A1-S") },
            { text: "AWP (locked)", disabled: true },
        ],
    });
});

command("!colors", (player: Player | null): void => {
    if (player === null) {
        return;
    }

    // A centre menu: navigated with W/S/E, and kept open after a pick so the player can
    // try more than one. The handle outlives this call — a timer closes it later.
    const open = menu.open(player, {
        title: "Team colour",
        style: "center",
        closeOnSelect: false,
        items: [
            { text: "red", onSelect: (p) => p.sendCenter("red it is") },
            { text: "blue", onSelect: (p) => p.sendCenter("blue it is") },
        ],
    });

    setTimeout(() => {
        if (open.isOpen) {
            open.close();
        }
    }, 30_000);
});

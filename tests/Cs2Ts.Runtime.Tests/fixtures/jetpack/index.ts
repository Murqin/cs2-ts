// A plugin that is a folder: this file is what loads, and physics.ts beside it is a
// module it imports. Nothing loads physics.ts on its own, and nothing outside this
// folder can import it.

import { boostFrom, clamp } from "./physics.ts";

// Module scope, not global scope. Another plugin in the scripts folder may have a
// `charge` of its own and neither the compiler nor the runtime will mind.
const charge = new Map<number, number>();

command("!jetpack", (player: Player | null): void => {
    if (player === null || !player.isAlive) {
        console.log("jetpack needs someone in the world");
        return;
    }

    const left = clamp(charge.get(player.id) ?? 1, 0, 1);
    if (left <= 0) {
        player.sendChat("jetpack is empty until the next round");
        return;
    }

    const here = player.position;
    const top = boostFrom(here.z, left);
    player.teleport(here.x, here.y, top);
    charge.set(player.id, left - 0.5);

    console.log(`${player.name} boosted to ${top}`);
});

on("round_start", (): void => {
    charge.clear();
    console.log("jetpacks refuelled");
});

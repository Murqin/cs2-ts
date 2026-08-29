// Ambient declarations for what a CS2-TS script can actually reach today.
//
// This is not @cs2-ts/api. That is a later, published package with the full surface;
// this file exists because the shipped tsconfig turns unknown globals into errors, and
// without it every script fails to compile on the first line. It declares exactly what
// the runtime installs and nothing it does not — a declaration for something that has
// not been written yet is worse than no declaration at all.

declare global {
    /**
     * A reference to something in the game. It holds an identity, never a pointer, so
     * it stays meaningful after the entity is gone — it just stops resolving.
     */
    interface EntityHandle<T = unknown> {
        /** The durable identity. For a player, their userid. */
        readonly id: number;

        /** What this refers to: "player". */
        readonly kind: string;

        /**
         * Whether the entity is still there. Cheap; check it before doing work.
         *
         * False once the entity is gone, and also once the id belongs to something
         * else. A player's userid is a place on the server rather than a person: the
         * game takes it back when they leave and hands the number out again later. So
         * the reference remembers the Steam ID that was there when it was made and
         * checks it, and a reference kept across a departure reads as gone rather than
         * quietly becoming a reference to whoever arrived next.
         */
        readonly isValid: boolean;

        /**
         * The live host object, or a thrown Error if the entity has left the game.
         *
         * This is the escape hatch. What comes back is the CounterStrikeSharp object
         * itself, untyped on purpose: past this point the script is responsible for its
         * own validity checking, and for whatever it does with a native object.
         *
         * What it reaches is narrower than it looks, and this was measured on a server
         * rather than assumed. Ordinary CLR members work: `PlayerName` comes back as a
         * string, and methods can be called. Networked schema fields do not work at
         * all, in either direction:
         *
         * - Reading one gives an object with nothing on it. `typeof` says "object",
         *   `Object.keys` is empty, `Number()` is `NaN`, `valueOf()` returns the same
         *   object, and it has no `GetType`. There is no way to get a number out of it.
         * - Writing one throws "The property set method is unavailable or
         *   inaccessible" — clearly, at least, rather than silently doing nothing.
         *
         * They are ref-returning properties in CounterStrikeSharp, which is why.
         * Health, armour, money and position are all on that side of the line, so this
         * is not the way to reach them: use the facade, or `unsafe` for a field the
         * facade does not have.
         */
        resolve(): T;

        toString(): string;
    }

    /**
     * A live object in the game, with every field it has on it.
     *
     * `Player` is the curated surface: a small number of members that are named for
     * what they mean and cannot be used wrongly. It will always be behind the game.
     * This is the floor underneath it, so that "there is no member for that yet" is a
     * reason to write a slightly uglier line rather than a reason to stop.
     *
     * Everything on `raw` is named the way the game names it, because nobody renamed
     * it: `armorValue`, `velocityModifier`, `isScoped`. That is the trade — the wide
     * surface is current and complete, and it reads like the engine's internals,
     * because it is them. Writing through it replicates, the same as the curated
     * members do.
     *
     * Holds an identity rather than a pointer, like everything else worth keeping. A
     * pawn stored before a respawn reads the new body afterwards; it does not read
     * freed memory.
     */
    interface Entity<TRaw> {
        /** What this is: "pawn", "controller", "entity". */
        readonly kind: string;

        /**
         * Whether the entity is still there — the player is on the server and, for a
         * pawn, in the world; for anything else, that it has not been removed. Cheap,
         * and never throws.
         */
        readonly isValid: boolean;

        /**
         * The entity's slot in the game's entity list: what the server console means by
         * "entity 42", and what `entities.byIndex` takes.
         *
         * Not an identity, and not something to keep. The game hands a slot back out
         * once what was in it is gone, so a stored index eventually names something
         * else — this object is the thing that knows the difference, so keep this. It
         * reads as -1 once the entity is gone rather than throwing, because an index is
         * the sort of thing that ends up in a log line.
         */
        readonly index: number;

        /**
         * The classname the map and the game use — "weapon_ak47", "planted_c4",
         * "func_door". The one thing that says what an entity is, and the name
         * `entities.find` searches by. Empty once the entity is gone.
         */
        readonly designerName: string;

        /** Every field the entity has, by name. Throws once the entity is gone. */
        readonly raw: TRaw;

        /**
         * Where the entity is, copied out at the moment of the read: changing what
         * comes back moves nothing.
         *
         * `null` for an entity that has no place in the world yet, which is what a
         * freshly created entity is until it is spawned. Throws once the entity is
         * gone, which is a different thing.
         */
        readonly position: { readonly x: number; readonly y: number; readonly z: number } | null;

        /** Moves the entity, keeping its angles and velocity. */
        teleport(x: number, y: number, z: number): void;

        /**
         * Brings a newly created entity into the world. Whatever was written to it
         * before this call is what it starts life with, which is the only reason
         * creating and spawning are two steps.
         */
        spawn(): void;

        /**
         * Takes the entity out of the world. Everything holding it — this object
         * included — reads as invalid afterwards.
         */
        remove(): void;

        /**
         * Fires one of the entity's map inputs: the same ones a level designer wires up
         * in Hammer — "Kill", "TurnOn", "Open", "AddOutput". `value` is what the input
         * takes, and is left out for the many that take nothing.
         *
         * No activator and no caller are passed. Those name the entity that triggered
         * the input and the one that relayed it, and a script firing an input directly
         * is neither, so the inputs that read them will see nothing.
         */
        input(name: string, value?: string): void;

        /**
         * The live CounterStrikeSharp object, or a thrown Error. The escape hatch, with
         * the same limits as `Player.resolve` — ordinary members work, schema fields do
         * not, and `unsafe` is the way to those.
         */
        resolve(): unknown;

        toString(): string;
    }

    /*
     * The fields of the two entities a player has, below. They are generated from
     * CounterStrikeSharp's own classes, so they are complete and current, and none of
     * them is curated: each one is named the way the schema names it and does exactly
     * what the engine does with it. `player.health` and the rest are the curated way to
     * the ordinary things; these are how to reach everything else.
     *
     * Three kinds of value arrive, and nothing else does. A number, a boolean, and a
     * string — and a string field is read-only, because CounterStrikeSharp's getter and
     * setter for one disagree about what a string field is and writing would overwrite
     * the first eight characters without reporting anything. A field wider than that has
     * no honest form here: a 64-bit value does not survive a JavaScript number, so it
     * arrives as a string with no way to write it back.
     *
     * What is missing is whole objects — sub-entities, vectors and angles, arrays, and
     * references to other entities. Those wait for a step that can give them a shape
     * worth having. `unsafe` still reaches a field by name in the meantime.
     *
     * Writing any of these replicates, the same as the curated members do.
     */
    // BEGIN GENERATED — tools/datagen writes everything to the next marker; do not edit.
    /** Every field a CCSPlayerPawn has, by name. */
    interface PawnRaw {
        /** CBaseEntity/m_flActualGravityScale */
        actualGravityScale: number;
        /** CBaseEntity/m_nActualMoveType — A MoveType_t. */
        actualMoveType: number;
        /** CCSPlayerPawn/m_allowAutoFollowTime */
        allowAutoFollowTime: number;
        /** CBaseModelEntity/m_bAllowFadeInView */
        allowFadeInView: boolean;
        /** CBaseAnimGraph/m_bAnimGraphUpdateEnabled */
        animGraphUpdateEnabled: boolean;
        /** CBaseEntity/m_flAnimTime */
        animTime: number;
        /** CBaseEntity/m_bAnimatedEveryTick */
        animatedEveryTick: boolean;
        /** CBaseAnimGraph/m_bAnimationUpdateScheduled */
        animationUpdateScheduled: boolean;
        /** CBaseCombatCharacter/m_bApplyStressDamage */
        applyStressDamage: boolean;
        /** CCSPlayerPawn/m_ArmorValue */
        armorValue: number;
        /** CCSPlayerPawnBase/m_blindStartTime */
        blindStartTime: number;
        /** CCSPlayerPawnBase/m_blindUntilTime */
        blindUntilTime: number;
        /** CCSPlayerPawn/m_iBlockingUseActionInProgress — A CSPlayerBlockingUseAction_t. */
        blockingUseActionInProgress: number;
        /** CBaseEntity/m_nBloodType — A BloodType. */
        bloodType: number;
        /** CCSPlayerPawn/m_bBotAllowActive */
        botAllowActive: boolean;
        /** CCSPlayerPawn/m_nCharacterDefIndex */
        characterDefIndex: number;
        /** CBaseEntity/m_bClientSideRagdoll */
        clientSideRagdoll: boolean;
        /** CCSPlayerPawn/m_bCommittingSuicideOnTeamChange */
        committingSuicideOnTeamChange: boolean;
        /** CBaseEntity/m_flCreateTime */
        createTime: number;
        /** CCSPlayerPawn/m_unCurrentEquipmentValue */
        currentEquipmentValue: number;
        /** CBaseEntity/m_iCurrentThinkContext */
        currentThinkContext: number;
        /** CBaseEntity/m_flDamageAccumulator */
        damageAccumulator: number;
        /** CBaseEntity/m_iszDamageFilterName — Read-only, as every string field is. */
        readonly damageFilterName: string;
        /** CCSPlayerPawn/m_flDealtDamageToEnemyMostRecentTimestamp */
        dealtDamageToEnemyMostRecentTimestamp: number;
        /** CBaseCombatCharacter/m_bDeathEventsDispatched */
        deathEventsDispatched: boolean;
        /** CCSPlayerPawn/m_iDeathFlags */
        deathFlags: number;
        /** CCSPlayerPawn/m_flDeathInfoTime */
        deathInfoTime: number;
        /** CBasePlayerPawn/m_flDeathTime */
        deathTime: number;
        /** CBaseModelEntity/m_nDestructiblePartInitialStateDestructed0 — A HitGroup_t. */
        destructiblePartInitialStateDestructed0: number;
        /** CBaseModelEntity/m_bDestructiblePartInitialStateDestructed0_GenerateBreakpieces */
        destructiblePartInitialStateDestructed0_GenerateBreakpieces: boolean;
        /** CBaseModelEntity/m_nDestructiblePartInitialStateDestructed0_PartIndex */
        destructiblePartInitialStateDestructed0_PartIndex: number;
        /** CBaseModelEntity/m_nDestructiblePartInitialStateDestructed1 — A HitGroup_t. */
        destructiblePartInitialStateDestructed1: number;
        /** CBaseModelEntity/m_bDestructiblePartInitialStateDestructed1_GenerateBreakpieces */
        destructiblePartInitialStateDestructed1_GenerateBreakpieces: boolean;
        /** CBaseModelEntity/m_nDestructiblePartInitialStateDestructed1_PartIndex */
        destructiblePartInitialStateDestructed1_PartIndex: number;
        /** CBaseModelEntity/m_nDestructiblePartInitialStateDestructed2 — A HitGroup_t. */
        destructiblePartInitialStateDestructed2: number;
        /** CBaseModelEntity/m_bDestructiblePartInitialStateDestructed2_GenerateBreakpieces */
        destructiblePartInitialStateDestructed2_GenerateBreakpieces: boolean;
        /** CBaseModelEntity/m_nDestructiblePartInitialStateDestructed2_PartIndex */
        destructiblePartInitialStateDestructed2_PartIndex: number;
        /** CBaseModelEntity/m_nDestructiblePartInitialStateDestructed3 — A HitGroup_t. */
        destructiblePartInitialStateDestructed3: number;
        /** CBaseModelEntity/m_bDestructiblePartInitialStateDestructed3_GenerateBreakpieces */
        destructiblePartInitialStateDestructed3_GenerateBreakpieces: boolean;
        /** CBaseModelEntity/m_nDestructiblePartInitialStateDestructed3_PartIndex */
        destructiblePartInitialStateDestructed3_PartIndex: number;
        /** CBaseModelEntity/m_nDestructiblePartInitialStateDestructed4 — A HitGroup_t. */
        destructiblePartInitialStateDestructed4: number;
        /** CBaseModelEntity/m_bDestructiblePartInitialStateDestructed4_GenerateBreakpieces */
        destructiblePartInitialStateDestructed4_GenerateBreakpieces: boolean;
        /** CBaseModelEntity/m_nDestructiblePartInitialStateDestructed4_PartIndex */
        destructiblePartInitialStateDestructed4_PartIndex: number;
        /** CBaseEntity/m_bDisableLowViolence */
        disableLowViolence: boolean;
        /** CBaseEntity/m_bDisabledContextThinks */
        disabledContextThinks: boolean;
        /** CCSPlayerPawn/m_iDisplayHistoryBits */
        displayHistoryBits: number;
        /** CBaseModelEntity/m_flDissolveStartTime */
        dissolveStartTime: number;
        /** CBaseEntity/m_iEFlags */
        eFlags: number;
        /** CCSPlayerPawn/m_nEconGlovesChanged */
        econGlovesChanged: number;
        /** CBaseEntity/m_fEffects */
        effects: number;
        /** CBaseEntity/m_flElasticity */
        elasticity: number;
        /** CCSPlayerPawn/m_flEmitSoundTime */
        emitSoundTime: number;
        /** CBaseModelEntity/m_fadeMaxDist */
        fadeMaxDist: number;
        /** CBaseModelEntity/m_fadeMinDist */
        fadeMinDist: number;
        /** CBaseModelEntity/m_flFadeScale */
        fadeScale: number;
        /** CBaseEntity/m_fFlags */
        flags: number;
        /** CCSPlayerPawnBase/m_flFlashDuration */
        flashDuration: number;
        /** CCSPlayerPawnBase/m_flFlashMaxAlpha */
        flashMaxAlpha: number;
        /** CCSPlayerPawn/m_flFlinchStack */
        flinchStack: number;
        /** CBaseAnimGraph/m_nForceBone */
        forceBone: number;
        /** CBaseCombatCharacter/m_bForceServerRagdoll */
        forceServerRagdoll: boolean;
        /** CCSPlayerPawn/m_unFreezetimeEndEquipmentValue */
        freezetimeEndEquipmentValue: number;
        /** CBaseEntity/m_flFriction */
        friction: number;
        /** CBaseEntity/m_iGlobalname — Read-only, as every string field is. */
        readonly globalname: string;
        /** CBaseModelEntity/m_flGlowBackfaceMult */
        glowBackfaceMult: number;
        /** CBaseEntity/m_bGravityActuallyDisabled */
        gravityActuallyDisabled: boolean;
        /** CBaseEntity/m_bGravityDisabled */
        gravityDisabled: boolean;
        /** CBaseEntity/m_flGravityScale */
        gravityScale: number;
        /** CCSPlayerPawn/m_grenadeParameterStashTime */
        grenadeParameterStashTime: number;
        /** CCSPlayerPawn/m_bGrenadeParametersStashed */
        grenadeParametersStashed: boolean;
        /** CBaseEntity/m_nGroundBodyIndex */
        groundBodyIndex: number;
        /** CCSPlayerPawn/m_bGunGameImmunity */
        gunGameImmunity: boolean;
        /** CCSPlayerPawn/m_bHasDeathInfo */
        hasDeathInfo: boolean;
        /** CCSPlayerPawn/m_bHasFemaleVoice */
        hasFemaleVoice: boolean;
        /** CCSPlayerPawnBase/m_bHasMovedSinceSpawn */
        hasMovedSinceSpawn: boolean;
        /** CBaseEntity/m_iHealth */
        health: number;
        /** CCSPlayerPawn/m_flHealthShotBoostExpirationTime */
        healthShotBoostExpirationTime: number;
        /** CBasePlayerPawn/m_iHideHUD */
        hideHUD: number;
        /** CBasePlayerPawn/m_fHltvReplayDelay */
        hltvReplayDelay: number;
        /** CBasePlayerPawn/m_fHltvReplayEnd */
        hltvReplayEnd: number;
        /** CBaseCombatCharacter/m_eHull — A Hull_t. */
        hull: number;
        /** CCSPlayerPawnBase/m_flIdleTimeSinceLastAction */
        idleTimeSinceLastAction: number;
        /** CCSPlayerPawn/m_ignoreLadderJumpTime */
        ignoreLadderJumpTime: number;
        /** CCSPlayerPawn/m_fImmuneToGunGameDamageTime */
        immuneToGunGameDamageTime: number;
        /** CBaseCombatCharacter/m_impactEnergyScale */
        impactEnergyScale: number;
        /** CCSPlayerPawn/m_bInBombZone */
        inBombZone: boolean;
        /** CCSPlayerPawn/m_bInBombZoneTrigger */
        inBombZoneTrigger: boolean;
        /** CCSPlayerPawn/m_bInBuyZone */
        inBuyZone: boolean;
        /** CCSPlayerPawn/m_bInHostageRescueZone */
        inHostageRescueZone: boolean;
        /** CCSPlayerPawn/m_bInHostageResetZone */
        inHostageResetZone: boolean;
        /** CCSPlayerPawn/m_bInNoDefuseArea */
        inNoDefuseArea: boolean;
        /** CBasePlayerPawn/m_fInitHUD */
        initHUD: boolean;
        /** CBaseEntity/m_iInitialTeamNum */
        initialTeamNum: number;
        /** CBaseAnimGraph/m_bInitiallyPopulateInterpHistory */
        initiallyPopulateInterpHistory: boolean;
        /** CBaseEntity/m_ubInterpolationFrame */
        interpolationFrame: number;
        /** CCSPlayerPawn/m_bIsBuyMenuOpen */
        isBuyMenuOpen: boolean;
        /** CCSPlayerPawn/m_bIsDefusing */
        isDefusing: boolean;
        /** CCSPlayerPawn/m_bIsGrabbingHostage */
        isGrabbingHostage: boolean;
        /** CCSPlayerPawn/m_bIsScoped */
        isScoped: boolean;
        /** CCSPlayerPawn/m_bIsSpawning */
        isSpawning: boolean;
        /** CCSPlayerPawn/m_bIsWalking */
        isWalking: boolean;
        /** CCSPlayerPawn/m_bKilledByHeadshot */
        killedByHeadshot: boolean;
        /** CBaseEntity/m_bLagCompensate */
        lagCompensate: boolean;
        /** CCSPlayerPawn/m_flLandingTimeSeconds */
        landingTimeSeconds: number;
        /** CCSPlayerPawn/m_flLastAttackedTeammate */
        lastAttackedTeammate: number;
        /** CCSPlayerPawn/m_fLastGivenBombTime */
        lastGivenBombTime: number;
        /** CCSPlayerPawn/m_fLastGivenDefuserTime */
        lastGivenDefuserTime: number;
        /** CCSPlayerPawn/m_LastHitBox */
        lastHitBox: number;
        /** CCSPlayerPawn/m_lastLandTime */
        lastLandTime: number;
        /** CBaseEntity/m_lastNetworkChange */
        lastNetworkChange: number;
        /** CCSPlayerPawn/m_nLastPickupPriority */
        lastPickupPriority: number;
        /** CCSPlayerPawn/m_flLastPickupPriorityTime */
        lastPickupPriorityTime: number;
        /** CCSPlayerPawn/m_szLastPlaceName — Read-only, as every string field is. */
        readonly lastPlaceName: string;
        /** CBaseEntity/m_nLastThinkTick */
        lastThinkTick: number;
        /** CCSPlayerPawn/m_iLastWeaponFireUsercmd */
        lastWeaponFireUsercmd: number;
        /** CCSPlayerPawn/m_bLeftHanded */
        leftHanded: boolean;
        /** CBaseEntity/m_lifeState */
        lifeState: number;
        /** CBaseEntity/m_flLocalTime */
        localTime: number;
        /** CBaseEntity/m_iMaxHealth */
        maxHealth: number;
        /** CCSPlayerPawn/m_fMolotovDamageTime */
        molotovDamageTime: number;
        /** CBaseEntity/m_MoveCollide — A MoveCollide_t. */
        moveCollide: number;
        /** CBaseEntity/m_flMoveDoneTime */
        moveDoneTime: number;
        /** CBaseEntity/m_MoveType — A MoveType_t. */
        moveType: number;
        /** CBaseCombatCharacter/m_nNavHullIdx */
        navHullIdx: number;
        /** CBaseEntity/m_flNavIgnoreUntilTime */
        navIgnoreUntilTime: number;
        /** CBaseEntity/m_bNetworkQuantizeOriginAndAngles */
        networkQuantizeOriginAndAngles: boolean;
        /** CCSPlayerPawnBase/m_fNextRadarUpdateTime */
        nextRadarUpdateTime: number;
        /** CCSPlayerPawn/m_flNextSprayDecalTime */
        nextSprayDecalTime: number;
        /** CCSPlayerPawn/m_bNextSprayDecalTimeExpedited */
        nextSprayDecalTimeExpedited: boolean;
        /** CBasePlayerPawn/m_fNextSuicideTime */
        nextSuicideTime: number;
        /** CBaseEntity/m_nNextThinkTick */
        nextThinkTick: number;
        /** CBaseModelEntity/m_bNoInterpolate */
        noInterpolate: boolean;
        /** CCSPlayerPawnBase/m_iNumSpawns */
        numSpawns: number;
        /** CBaseModelEntity/m_nObjectCulling */
        objectCulling: number;
        /** CCSPlayerPawn/m_bOnGroundLastTick */
        onGroundLastTick: boolean;
        /** CBaseEntity/m_nPlatformType — A EntityPlatformTypes_t. */
        platformType: number;
        /** CCSPlayerPawn/m_iPlayerLocked */
        playerLocked: number;
        /** CCSPlayerPawnBase/m_iPlayerState — A CSPlayerState. */
        playerState: number;
        /** CBaseEntity/m_nPreviouslySetMoveType — A MoveType_t. */
        previouslySetMoveType: number;
        /** CEntityInstance/m_iszPrivateVScripts — Read-only, as every string field is. */
        readonly privateVScripts: string;
        /** CCSPlayerPawnBase/m_iProgressBarDuration */
        progressBarDuration: number;
        /** CCSPlayerPawnBase/m_flProgressBarStartTime */
        progressBarStartTime: number;
        /** CBaseEntity/m_nPushEnumCount */
        pushEnumCount: number;
        /** CBaseAnimGraph/m_bRagdollClientSide */
        ragdollClientSide: boolean;
        /** CCSPlayerPawn/m_nRagdollDamageBone */
        ragdollDamageBone: number;
        /** CCSPlayerPawn/m_bRagdollDamageHeadshot */
        ragdollDamageHeadshot: boolean;
        /** CCSPlayerPawn/m_szRagdollDamageWeaponName — Read-only, as every string field is. */
        readonly ragdollDamageWeaponName: string;
        /** CBaseAnimGraph/m_bRagdollEnabled */
        ragdollEnabled: boolean;
        /** CBaseModelEntity/m_nRenderFX — A RenderFx_t. */
        renderFX: number;
        /** CBaseModelEntity/m_nRenderMode — A RenderMode_t. */
        renderMode: number;
        /** CBaseModelEntity/m_bRenderToCubemaps */
        renderToCubemaps: boolean;
        /** CCSPlayerPawn/m_bResetArmorNextSpawn */
        resetArmorNextSpawn: boolean;
        /** CCSPlayerPawnBase/m_bRespawning */
        respawning: boolean;
        /** CBaseEntity/m_iszResponseContext — Read-only, as every string field is. */
        readonly responseContext: string;
        /** CBaseEntity/m_bRestoreInHierarchy */
        restoreInHierarchy: boolean;
        /** CCSPlayerPawn/m_bResumeZoom */
        resumeZoom: boolean;
        /** CCSPlayerPawn/m_bRetakesHasDefuseKit */
        retakesHasDefuseKit: boolean;
        /** CCSPlayerPawn/m_RetakesMVPBoostExtraUtility — A loadout_slot_t. */
        retakesMVPBoostExtraUtility: number;
        /** CCSPlayerPawn/m_iRetakesMVPBoostItem */
        retakesMVPBoostItem: number;
        /** CCSPlayerPawn/m_bRetakesMVPLastRound */
        retakesMVPLastRound: boolean;
        /** CCSPlayerPawn/m_iRetakesOffering */
        retakesOffering: number;
        /** CCSPlayerPawn/m_iRetakesOfferingCard */
        retakesOfferingCard: number;
        /** CCSPlayerPawn/m_unRoundStartEquipmentValue */
        roundStartEquipmentValue: number;
        /** CBaseEntity/m_iSentToClients */
        sentToClients: number;
        /** CBaseModelEntity/m_flShadowStrength */
        shadowStrength: number;
        /** CCSPlayerPawn/m_iShotsFired */
        shotsFired: number;
        /** CBaseEntity/m_nSimulationTick */
        simulationTick: number;
        /** CBaseEntity/m_flSimulationTime */
        simulationTime: number;
        /** CBaseEntity/m_nSlimeTouch */
        slimeTouch: number;
        /** CBaseEntity/m_spawnflags */
        spawnflags: number;
        /** CCSPlayerPawn/m_nSpotRules */
        spotRules: number;
        /** CBaseCombatCharacter/m_strRelationships — Read-only, as every string field is. */
        readonly strRelationships: string;
        /** CCSPlayerPawn/m_strVOPrefix — Read-only, as every string field is. */
        readonly strVOPrefix: string;
        /** CCSPlayerPawn/m_fSwitchedHandednessTime */
        switchedHandednessTime: number;
        /** CBaseEntity/m_nTakeDamageFlags — A TakeDamageFlags_t. */
        takeDamageFlags: number;
        /** CBaseEntity/m_bTakesDamage */
        takesDamage: boolean;
        /** CBaseEntity/m_target — Read-only, as every string field is. */
        readonly target: string;
        /** CBaseEntity/m_iTeamNum */
        teamNum: number;
        /** CBasePlayerPawn/m_fTimeLastHurt */
        timeLastHurt: number;
        /** CCSPlayerPawn/m_flTimeOfLastInjury */
        timeOfLastInjury: number;
        /** CBaseEntity/m_flTimeScale */
        timeScale: number;
        /** CBaseEntity/m_sUniqueHammerID — Read-only, as every string field is. */
        readonly uniqueHammerID: string;
        /** CBaseEntity/m_flVPhysicsUpdateLocalTime */
        vPhysicsUpdateLocalTime: number;
        /** CCSPlayerPawn/m_flVelocityModifier */
        velocityModifier: number;
        /** CCSPlayerPawn/m_flViewmodelFOV */
        viewmodelFOV: number;
        /** CCSPlayerPawn/m_flViewmodelOffsetX */
        viewmodelOffsetX: number;
        /** CCSPlayerPawn/m_flViewmodelOffsetY */
        viewmodelOffsetY: number;
        /** CCSPlayerPawn/m_flViewmodelOffsetZ */
        viewmodelOffsetZ: number;
        /** CCSPlayerPawn/m_bWaitForNoAttack */
        waitForNoAttack: boolean;
        /** CCSPlayerPawn/m_bWasInBombZoneTrigger */
        wasInBombZoneTrigger: boolean;
        /** CCSPlayerPawn/m_bWasInBuyZone */
        wasInBuyZone: boolean;
        /** CCSPlayerPawn/m_bWasInHostageRescueZone */
        wasInHostageRescueZone: boolean;
        /** CCSPlayerPawn/m_wasNotKilledNaturally */
        wasNotKilledNaturally: boolean;
        /** CBaseEntity/m_flWaterLevel */
        waterLevel: number;
        /** CBaseEntity/m_nWaterTouch */
        waterTouch: number;
        /** CBaseEntity/m_nWaterType */
        waterType: number;
        /** CCSPlayerPawn/m_nWhichBombZone */
        whichBombZone: number;
    }

    /** Every field a CCSPlayerController has, by name. */
    interface ControllerRaw {
        /** CCSPlayerController/m_bAbandonAllowsSurrender */
        abandonAllowsSurrender: boolean;
        /** CCSPlayerController/m_bAbandonOffersInstantSurrender */
        abandonOffersInstantSurrender: boolean;
        /** CCSPlayerController/m_unActiveQuestId */
        activeQuestId: number;
        /** CBaseEntity/m_flActualGravityScale */
        actualGravityScale: number;
        /** CBaseEntity/m_nActualMoveType — A MoveType_t. */
        actualMoveType: number;
        /** CBaseEntity/m_flAnimTime */
        animTime: number;
        /** CBaseEntity/m_bAnimatedEveryTick */
        animatedEveryTick: boolean;
        /** CCSPlayerController/m_bAttemptedToGetColor */
        attemptedToGetColor: boolean;
        /** CBasePlayerController/m_nAvailableEntitySteadyState */
        availableEntitySteadyState: number;
        /** CBaseEntity/m_nBloodType — A BloodType. */
        bloodType: number;
        /** CCSPlayerController/m_nBotsControlledThisRound */
        botsControlledThisRound: number;
        /** CCSPlayerController/m_bCanControlObservedBot */
        canControlObservedBot: boolean;
        /** CCSPlayerController/m_bCannotBeKicked */
        cannotBeKicked: boolean;
        /** CCSPlayerController/m_szClan — Read-only, as every string field is. */
        readonly clan: string;
        /** CBaseEntity/m_bClientSideRagdoll */
        clientSideRagdoll: boolean;
        /** CCSPlayerController/m_iCoachingTeam */
        coachingTeam: number;
        /** CCSPlayerController/m_iCompTeammateColor */
        compTeammateColor: number;
        /** CCSPlayerController/m_iCompetitiveRankType */
        competitiveRankType: number;
        /** CCSPlayerController/m_iCompetitiveRanking */
        competitiveRanking: number;
        /** CCSPlayerController/m_iCompetitiveRankingPredicted_Loss */
        competitiveRankingPredicted_Loss: number;
        /** CCSPlayerController/m_iCompetitiveRankingPredicted_Tie */
        competitiveRankingPredicted_Tie: number;
        /** CCSPlayerController/m_iCompetitiveRankingPredicted_Win */
        competitiveRankingPredicted_Win: number;
        /** CCSPlayerController/m_iCompetitiveWins */
        competitiveWins: number;
        /** CBasePlayerController/m_iConnected — A PlayerConnectedState. */
        connected: number;
        /** CCSPlayerController/m_bControllingBot */
        controllingBot: boolean;
        /** CBaseEntity/m_flCreateTime */
        createTime: number;
        /** CCSPlayerController/m_szCrosshairCodes — Read-only, as every string field is. */
        readonly crosshairCodes: string;
        /** CBaseEntity/m_iCurrentThinkContext */
        currentThinkContext: number;
        /** CBaseEntity/m_flDamageAccumulator */
        damageAccumulator: number;
        /** CBaseEntity/m_iszDamageFilterName — Read-only, as every string field is. */
        readonly damageFilterName: string;
        /** CCSPlayerController/m_dblLastReceivedPacketPlatFloatTime */
        dblLastReceivedPacketPlatFloatTime: number;
        /** CBasePlayerController/m_iDesiredFOV */
        desiredFOV: number;
        /** CCSPlayerController/m_DesiredObserverMode */
        desiredObserverMode: number;
        /** CBaseEntity/m_bDisableLowViolence */
        disableLowViolence: boolean;
        /** CBaseEntity/m_bDisabledContextThinks */
        disabledContextThinks: boolean;
        /** CCSPlayerController/m_bDisconnection1MinWarningPrinted */
        disconnection1MinWarningPrinted: boolean;
        /** CCSPlayerController/m_nDisconnectionTick */
        disconnectionTick: number;
        /** CCSPlayerController/m_iDraftIndex */
        draftIndex: number;
        /** CBaseEntity/m_iEFlags */
        eFlags: number;
        /** CBaseEntity/m_fEffects */
        effects: number;
        /** CBaseEntity/m_flElasticity */
        elasticity: number;
        /** CCSPlayerController/m_nEndMatchNextMapVote */
        endMatchNextMapVote: number;
        /** CCSPlayerController/m_bEverFullyConnected */
        everFullyConnected: boolean;
        /** CCSPlayerController/m_bEverPlayedOnTeam */
        everPlayedOnTeam: boolean;
        /** CCSPlayerController/m_bFireBulletsSeedSynchronized */
        fireBulletsSeedSynchronized: boolean;
        /** CCSPlayerController/m_nFirstKill */
        firstKill: number;
        /** CBaseEntity/m_fFlags */
        flags: number;
        /** CCSPlayerController/m_flForceTeamTime */
        forceTeamTime: number;
        /** CBaseEntity/m_flFriction */
        friction: number;
        /** CBasePlayerController/m_bGamePaused */
        gamePaused: boolean;
        /** CCSPlayerController/m_bGaveTeamDamageWarning */
        gaveTeamDamageWarning: boolean;
        /** CCSPlayerController/m_bGaveTeamDamageWarningThisRound */
        gaveTeamDamageWarningThisRound: boolean;
        /** CBaseEntity/m_iGlobalname — Read-only, as every string field is. */
        readonly globalname: string;
        /** CBaseEntity/m_bGravityActuallyDisabled */
        gravityActuallyDisabled: boolean;
        /** CBaseEntity/m_bGravityDisabled */
        gravityDisabled: boolean;
        /** CBaseEntity/m_flGravityScale */
        gravityScale: number;
        /** CBaseEntity/m_nGroundBodyIndex */
        groundBodyIndex: number;
        /** CBasePlayerController/m_bHasAnySteadyStateEnts */
        hasAnySteadyStateEnts: boolean;
        /** CCSPlayerController/m_bHasBeenControlledByPlayerThisRound */
        hasBeenControlledByPlayerThisRound: boolean;
        /** CCSPlayerController/m_bHasCommunicationAbuseMute */
        hasCommunicationAbuseMute: boolean;
        /** CCSPlayerController/m_bHasControlledBotThisRound */
        hasControlledBotThisRound: boolean;
        /** CCSPlayerController/m_bHasSeenJoinGame */
        hasSeenJoinGame: boolean;
        /** CBaseEntity/m_iHealth */
        health: number;
        /** CBasePlayerController/m_iIgnoreGlobalChat — A ChatIgnoreType_t. */
        ignoreGlobalChat: number;
        /** CBasePlayerController/m_nInButtonsWhichAreToggles — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly inButtonsWhichAreToggles: string;
        /** CCSPlayerController/m_bInSwitchTeam */
        inSwitchTeam: boolean;
        /** CBaseEntity/m_iInitialTeamNum */
        initialTeamNum: number;
        /** CBaseEntity/m_ubInterpolationFrame */
        interpolationFrame: number;
        /** CBasePlayerController/m_bIsHLTV */
        isHLTV: boolean;
        /** CBasePlayerController/m_bIsLowViolence */
        isLowViolence: boolean;
        /** CCSPlayerController/m_bJustBecameSpectator */
        justBecameSpectator: boolean;
        /** CCSPlayerController/m_bJustDidTeamKill */
        justDidTeamKill: boolean;
        /** CCSPlayerController/m_nKillCount */
        killCount: number;
        /** CBasePlayerController/m_bKnownTeamMismatch */
        knownTeamMismatch: boolean;
        /** CBaseEntity/m_bLagCompensate */
        lagCompensate: boolean;
        /** CBasePlayerController/m_bLagCompensation */
        lagCompensation: boolean;
        /** CBasePlayerController/m_flLastEntitySteadyState */
        lastEntitySteadyState: number;
        /** CCSPlayerController/m_flLastJoinTeamTime */
        lastJoinTeamTime: number;
        /** CBaseEntity/m_lastNetworkChange */
        lastNetworkChange: number;
        /** CBasePlayerController/m_flLastPlayerTalkTime */
        lastPlayerTalkTime: number;
        /** CCSPlayerController/m_LastTeamDamageWarningTime */
        lastTeamDamageWarningTime: number;
        /** CBaseEntity/m_nLastThinkTick */
        lastThinkTick: number;
        /** CCSPlayerController/m_LastTimePlayerWasDisconnectedForPawnsRemove */
        lastTimePlayerWasDisconnectedForPawnsRemove: number;
        /** CBasePlayerController/m_fLerpTime */
        lerpTime: number;
        /** CBaseEntity/m_lifeState */
        lifeState: number;
        /** CBaseEntity/m_flLocalTime */
        localTime: number;
        /** CCSPlayerController/m_iMVPs */
        mVPs: number;
        /** CBaseEntity/m_iMaxHealth */
        maxHealth: number;
        /** CBasePlayerController/m_iMostConnected — A PlayerConnectedState. */
        mostConnected: number;
        /** CBaseEntity/m_MoveCollide — A MoveCollide_t. */
        moveCollide: number;
        /** CBaseEntity/m_flMoveDoneTime */
        moveDoneTime: number;
        /** CBaseEntity/m_MoveType — A MoveType_t. */
        moveType: number;
        /** CCSPlayerController/m_msQueuedModeDisconnectionTimestamp */
        msQueuedModeDisconnectionTimestamp: number;
        /** CCSPlayerController/m_iMusicKitID */
        musicKitID: number;
        /** CCSPlayerController/m_iMusicKitMVPs */
        musicKitMVPs: number;
        /** CCSPlayerController/m_bMvpNoMusic */
        mvpNoMusic: boolean;
        /** CCSPlayerController/m_eMvpReason */
        mvpReason: number;
        /** CBaseEntity/m_flNavIgnoreUntilTime */
        navIgnoreUntilTime: number;
        /** CCSPlayerController/m_eNetworkDisconnectionReason */
        networkDisconnectionReason: number;
        /** CBasePlayerController/m_szNetworkIDString — Read-only, as every string field is. */
        readonly networkIDString: string;
        /** CBaseEntity/m_bNetworkQuantizeOriginAndAngles */
        networkQuantizeOriginAndAngles: boolean;
        /** CBaseEntity/m_nNextThinkTick */
        nextThinkTick: number;
        /** CCSPlayerController/m_iNextTimeCheck */
        nextTimeCheck: number;
        /** CBasePlayerController/m_bNoClipEnabled */
        noClipEnabled: boolean;
        /** CCSPlayerController/m_nNonSuspiciousHitStreak */
        nonSuspiciousHitStreak: number;
        /** CCSPlayerController/m_iPawnArmor */
        pawnArmor: number;
        /** CCSPlayerController/m_iPawnBotDifficulty */
        pawnBotDifficulty: number;
        /** CCSPlayerController/m_nPawnCharacterDefIndex */
        pawnCharacterDefIndex: number;
        /** CCSPlayerController/m_bPawnHasDefuser */
        pawnHasDefuser: boolean;
        /** CCSPlayerController/m_bPawnHasHelmet */
        pawnHasHelmet: boolean;
        /** CCSPlayerController/m_iPawnHealth */
        pawnHealth: number;
        /** CCSPlayerController/m_bPawnIsAlive */
        pawnIsAlive: boolean;
        /** CCSPlayerController/m_iPawnLifetimeEnd */
        pawnLifetimeEnd: number;
        /** CCSPlayerController/m_iPawnLifetimeStart */
        pawnLifetimeStart: number;
        /** CCSPlayerController/m_iPendingTeamNum */
        pendingTeamNum: number;
        /** CCSPlayerController/m_iPing */
        ping: number;
        /** CBaseEntity/m_nPlatformType — A EntityPlatformTypes_t. */
        platformType: number;
        /** CCSPlayerController/m_nPlayerDominated — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly playerDominated: string;
        /** CCSPlayerController/m_nPlayerDominatingMe — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly playerDominatingMe: string;
        /** CBasePlayerController/m_iszPlayerName — Read-only, as every string field is. */
        readonly playerName: string;
        /** CCSPlayerController/m_unPlayerTvControlFlags */
        playerTvControlFlags: number;
        /** CBasePlayerController/m_bPredict */
        predict: boolean;
        /** CBaseEntity/m_nPreviouslySetMoveType — A MoveType_t. */
        previouslySetMoveType: number;
        /** CEntityInstance/m_iszPrivateVScripts — Read-only, as every string field is. */
        readonly privateVScripts: string;
        /** CCSPlayerController/m_bPunishForTeamKill */
        punishForTeamKill: boolean;
        /** CBaseEntity/m_nPushEnumCount */
        pushEnumCount: number;
        /** CCSPlayerController/m_bRemoveAllItemsOnNextRoundReset */
        removeAllItemsOnNextRoundReset: boolean;
        /** CBaseEntity/m_iszResponseContext — Read-only, as every string field is. */
        readonly responseContext: string;
        /** CBaseEntity/m_bRestoreInHierarchy */
        restoreInHierarchy: boolean;
        /** CCSPlayerController/m_iRoundScore */
        roundScore: number;
        /** CCSPlayerController/m_iRoundsWon */
        roundsWon: number;
        /** CCSPlayerController/m_rtActiveMissionPeriod */
        rtActiveMissionPeriod: number;
        /** CCSPlayerController/m_iScore */
        score: number;
        /** CCSPlayerController/m_bScoreReported */
        scoreReported: boolean;
        /** CBaseEntity/m_iSentToClients */
        sentToClients: number;
        /** CCSPlayerController/m_bShowHints */
        showHints: boolean;
        /** CBaseEntity/m_nSimulationTick */
        simulationTick: number;
        /** CBaseEntity/m_flSimulationTime */
        simulationTime: number;
        /** CBaseEntity/m_nSlimeTouch */
        slimeTouch: number;
        /** CCSPlayerController/m_flSmoothedPing */
        smoothedPing: number;
        /** CBaseEntity/m_spawnflags */
        spawnflags: number;
        /** CBasePlayerController/m_nSplitScreenSlot */
        splitScreenSlot: number;
        /** CBasePlayerController/m_steamID — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly steamID: string;
        /** CCSPlayerController/m_nSuspiciousHitCount */
        suspiciousHitCount: number;
        /** CCSPlayerController/m_bSwitchTeamsOnNextRoundReset */
        switchTeamsOnNextRoundReset: boolean;
        /** CBaseEntity/m_nTakeDamageFlags — A TakeDamageFlags_t. */
        takeDamageFlags: number;
        /** CBaseEntity/m_bTakesDamage */
        takesDamage: boolean;
        /** CBaseEntity/m_target — Read-only, as every string field is. */
        readonly target: string;
        /** CCSPlayerController/m_bTeamChanged */
        teamChanged: boolean;
        /** CBaseEntity/m_iTeamNum */
        teamNum: number;
        /** CCSPlayerController/m_iTeammatePreferredColor */
        teammatePreferredColor: number;
        /** CBasePlayerController/m_nTickBase */
        tickBase: number;
        /** CBaseEntity/m_flTimeScale */
        timeScale: number;
        /** CCSPlayerController/m_uiAbandonRecordedReason */
        uiAbandonRecordedReason: number;
        /** CCSPlayerController/m_uiCommunicationMuteFlags */
        uiCommunicationMuteFlags: number;
        /** CBaseEntity/m_sUniqueHammerID — Read-only, as every string field is. */
        readonly uniqueHammerID: string;
        /** CCSPlayerController/m_nUpdateCounter */
        updateCounter: number;
        /** CBaseEntity/m_flVPhysicsUpdateLocalTime */
        vPhysicsUpdateLocalTime: number;
        /** CBaseEntity/m_flWaterLevel */
        waterLevel: number;
        /** CBaseEntity/m_nWaterTouch */
        waterTouch: number;
        /** CBaseEntity/m_nWaterType */
        waterType: number;
    }

    /** Every field a CBaseEntity has, by name. */
    interface EntityRaw {
        /** CBaseEntity/m_flActualGravityScale */
        actualGravityScale: number;
        /** CBaseEntity/m_nActualMoveType — A MoveType_t. */
        actualMoveType: number;
        /** CBaseEntity/m_flAnimTime */
        animTime: number;
        /** CBaseEntity/m_bAnimatedEveryTick */
        animatedEveryTick: boolean;
        /** CBaseEntity/m_nBloodType — A BloodType. */
        bloodType: number;
        /** CBaseEntity/m_bClientSideRagdoll */
        clientSideRagdoll: boolean;
        /** CBaseEntity/m_flCreateTime */
        createTime: number;
        /** CBaseEntity/m_iCurrentThinkContext */
        currentThinkContext: number;
        /** CBaseEntity/m_flDamageAccumulator */
        damageAccumulator: number;
        /** CBaseEntity/m_iszDamageFilterName — Read-only, as every string field is. */
        readonly damageFilterName: string;
        /** CBaseEntity/m_bDisableLowViolence */
        disableLowViolence: boolean;
        /** CBaseEntity/m_bDisabledContextThinks */
        disabledContextThinks: boolean;
        /** CBaseEntity/m_iEFlags */
        eFlags: number;
        /** CBaseEntity/m_fEffects */
        effects: number;
        /** CBaseEntity/m_flElasticity */
        elasticity: number;
        /** CBaseEntity/m_fFlags */
        flags: number;
        /** CBaseEntity/m_flFriction */
        friction: number;
        /** CBaseEntity/m_iGlobalname — Read-only, as every string field is. */
        readonly globalname: string;
        /** CBaseEntity/m_bGravityActuallyDisabled */
        gravityActuallyDisabled: boolean;
        /** CBaseEntity/m_bGravityDisabled */
        gravityDisabled: boolean;
        /** CBaseEntity/m_flGravityScale */
        gravityScale: number;
        /** CBaseEntity/m_nGroundBodyIndex */
        groundBodyIndex: number;
        /** CBaseEntity/m_iHealth */
        health: number;
        /** CBaseEntity/m_iInitialTeamNum */
        initialTeamNum: number;
        /** CBaseEntity/m_ubInterpolationFrame */
        interpolationFrame: number;
        /** CBaseEntity/m_bLagCompensate */
        lagCompensate: boolean;
        /** CBaseEntity/m_lastNetworkChange */
        lastNetworkChange: number;
        /** CBaseEntity/m_nLastThinkTick */
        lastThinkTick: number;
        /** CBaseEntity/m_lifeState */
        lifeState: number;
        /** CBaseEntity/m_flLocalTime */
        localTime: number;
        /** CBaseEntity/m_iMaxHealth */
        maxHealth: number;
        /** CBaseEntity/m_MoveCollide — A MoveCollide_t. */
        moveCollide: number;
        /** CBaseEntity/m_flMoveDoneTime */
        moveDoneTime: number;
        /** CBaseEntity/m_MoveType — A MoveType_t. */
        moveType: number;
        /** CBaseEntity/m_flNavIgnoreUntilTime */
        navIgnoreUntilTime: number;
        /** CBaseEntity/m_bNetworkQuantizeOriginAndAngles */
        networkQuantizeOriginAndAngles: boolean;
        /** CBaseEntity/m_nNextThinkTick */
        nextThinkTick: number;
        /** CBaseEntity/m_nPlatformType — A EntityPlatformTypes_t. */
        platformType: number;
        /** CBaseEntity/m_nPreviouslySetMoveType — A MoveType_t. */
        previouslySetMoveType: number;
        /** CEntityInstance/m_iszPrivateVScripts — Read-only, as every string field is. */
        readonly privateVScripts: string;
        /** CBaseEntity/m_nPushEnumCount */
        pushEnumCount: number;
        /** CBaseEntity/m_iszResponseContext — Read-only, as every string field is. */
        readonly responseContext: string;
        /** CBaseEntity/m_bRestoreInHierarchy */
        restoreInHierarchy: boolean;
        /** CBaseEntity/m_iSentToClients */
        sentToClients: number;
        /** CBaseEntity/m_nSimulationTick */
        simulationTick: number;
        /** CBaseEntity/m_flSimulationTime */
        simulationTime: number;
        /** CBaseEntity/m_nSlimeTouch */
        slimeTouch: number;
        /** CBaseEntity/m_spawnflags */
        spawnflags: number;
        /** CBaseEntity/m_nTakeDamageFlags — A TakeDamageFlags_t. */
        takeDamageFlags: number;
        /** CBaseEntity/m_bTakesDamage */
        takesDamage: boolean;
        /** CBaseEntity/m_target — Read-only, as every string field is. */
        readonly target: string;
        /** CBaseEntity/m_iTeamNum */
        teamNum: number;
        /** CBaseEntity/m_flTimeScale */
        timeScale: number;
        /** CBaseEntity/m_sUniqueHammerID — Read-only, as every string field is. */
        readonly uniqueHammerID: string;
        /** CBaseEntity/m_flVPhysicsUpdateLocalTime */
        vPhysicsUpdateLocalTime: number;
        /** CBaseEntity/m_flWaterLevel */
        waterLevel: number;
        /** CBaseEntity/m_nWaterTouch */
        waterTouch: number;
        /** CBaseEntity/m_nWaterType */
        waterType: number;
    }

    /** What the `achievement_earned` event carries. */
    interface AchievementEarnedEvent {
        /** EventAchievementEarned.Achievement */
        readonly achievement: number;
        /** EventAchievementEarned.Player */
        readonly player: Player | null;
    }

    /** What the `achievement_earned_local` event carries. */
    interface AchievementEarnedLocalEvent {
        /** EventAchievementEarnedLocal.Achievement */
        readonly achievement: number;
        /** EventAchievementEarnedLocal.Splitscreenplayer */
        readonly splitscreenplayer: number;
    }

    /** What the `achievement_event` event carries. */
    interface AchievementEventEvent {
        /** EventAchievementEvent.AchievementName */
        readonly achievementName: string;
        /** EventAchievementEvent.CurVal */
        readonly curVal: number;
        /** EventAchievementEvent.MaxVal */
        readonly maxVal: number;
    }

    /** What the `achievement_info_loaded` event carries. */
    interface AchievementInfoLoadedEvent {
    }

    /** What the `achievement_write_failed` event carries. */
    interface AchievementWriteFailedEvent {
    }

    /** What the `add_bullet_hit_marker` event carries. */
    interface AddBulletHitMarkerEvent {
        /** EventAddBulletHitMarker.AngX */
        readonly angX: number;
        /** EventAddBulletHitMarker.AngY */
        readonly angY: number;
        /** EventAddBulletHitMarker.AngZ */
        readonly angZ: number;
        /** EventAddBulletHitMarker.Bone */
        readonly bone: number;
        /** EventAddBulletHitMarker.Hit */
        readonly hit: boolean;
        /** EventAddBulletHitMarker.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventAddBulletHitMarker.PosX */
        readonly posX: number;
        /** EventAddBulletHitMarker.PosY */
        readonly posY: number;
        /** EventAddBulletHitMarker.PosZ */
        readonly posZ: number;
        /** EventAddBulletHitMarker.StartX */
        readonly startX: number;
        /** EventAddBulletHitMarker.StartY */
        readonly startY: number;
        /** EventAddBulletHitMarker.StartZ */
        readonly startZ: number;
    }

    /** What the `add_player_sonar_icon` event carries. */
    interface AddPlayerSonarIconEvent {
        /** EventAddPlayerSonarIcon.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventAddPlayerSonarIcon.PosX */
        readonly posX: number;
        /** EventAddPlayerSonarIcon.PosY */
        readonly posY: number;
        /** EventAddPlayerSonarIcon.PosZ */
        readonly posZ: number;
    }

    /** What the `ammo_pickup` event carries. */
    interface AmmoPickupEvent {
        /** EventAmmoPickup.Index */
        readonly index: number;
        /** EventAmmoPickup.Item */
        readonly item: string;
        /** EventAmmoPickup.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `ammo_refill` event carries. */
    interface AmmoRefillEvent {
        /** EventAmmoRefill.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventAmmoRefill.Success */
        readonly success: boolean;
    }

    /** What the `announce_phase_end` event carries. */
    interface AnnouncePhaseEndEvent {
    }

    /** What the `begin_new_match` event carries. */
    interface BeginNewMatchEvent {
    }

    /** What the `bomb_abortdefuse` event carries. */
    interface BombAbortdefuseEvent {
        /** EventBombAbortdefuse.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `bomb_abortplant` event carries. */
    interface BombAbortplantEvent {
        /** EventBombAbortplant.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventBombAbortplant.Site */
        readonly site: number;
    }

    /** What the `bomb_beep` event carries. */
    interface BombBeepEvent {
        /** EventBombBeep.Entindex */
        readonly entindex: number;
    }

    /** What the `bomb_begindefuse` event carries. */
    interface BombBegindefuseEvent {
        /** EventBombBegindefuse.Haskit */
        readonly haskit: boolean;
        /** EventBombBegindefuse.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `bomb_beginplant` event carries. */
    interface BombBeginplantEvent {
        /** EventBombBeginplant.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventBombBeginplant.Site */
        readonly site: number;
    }

    /** What the `bomb_defused` event carries. */
    interface BombDefusedEvent {
        /** EventBombDefused.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventBombDefused.Site */
        readonly site: number;
    }

    /** What the `bomb_dropped` event carries. */
    interface BombDroppedEvent {
        /** EventBombDropped.Entindex */
        readonly entindex: number;
        /** EventBombDropped.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `bomb_exploded` event carries. */
    interface BombExplodedEvent {
        /** EventBombExploded.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventBombExploded.Site */
        readonly site: number;
    }

    /** What the `bomb_pickup` event carries. */
    interface BombPickupEvent {
        /** EventBombPickup.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `bomb_planted` event carries. */
    interface BombPlantedEvent {
        /** EventBombPlanted.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventBombPlanted.Site */
        readonly site: number;
    }

    /** What the `bonus_updated` event carries. */
    interface BonusUpdatedEvent {
        /** EventBonusUpdated.Numadvanced */
        readonly numadvanced: number;
        /** EventBonusUpdated.Numbronze */
        readonly numbronze: number;
        /** EventBonusUpdated.Numgold */
        readonly numgold: number;
        /** EventBonusUpdated.Numsilver */
        readonly numsilver: number;
    }

    /** What the `bot_takeover` event carries. */
    interface BotTakeoverEvent {
        /** EventBotTakeover.Botid */
        readonly botid: Player | null;
        /** EventBotTakeover.P */
        readonly p: number;
        /** EventBotTakeover.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventBotTakeover.R */
        readonly r: number;
        /** EventBotTakeover.Y */
        readonly y: number;
    }

    /** What the `break_breakable` event carries. */
    interface BreakBreakableEvent {
        /** EventBreakBreakable.Entindex */
        readonly entindex: number;
        /** EventBreakBreakable.Material */
        readonly material: number;
        /** EventBreakBreakable.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `break_prop` event carries. */
    interface BreakPropEvent {
        /** EventBreakProp.Entindex */
        readonly entindex: number;
        /** EventBreakProp.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventBreakProp.PlayerDropped */
        readonly playerDropped: boolean;
        /** EventBreakProp.PlayerHeld */
        readonly playerHeld: boolean;
        /** EventBreakProp.PlayerThrown */
        readonly playerThrown: boolean;
    }

    /** What the `broken_breakable` event carries. */
    interface BrokenBreakableEvent {
        /** EventBrokenBreakable.Entindex */
        readonly entindex: number;
        /** EventBrokenBreakable.Material */
        readonly material: number;
        /** EventBrokenBreakable.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `bullet_damage` event carries. */
    interface BulletDamageEvent {
        /** EventBulletDamage.AimPunchX */
        readonly aimPunchX: number;
        /** EventBulletDamage.AimPunchY */
        readonly aimPunchY: number;
        /** EventBulletDamage.AimPunchZ */
        readonly aimPunchZ: number;
        /** EventBulletDamage.AttackTickCount */
        readonly attackTickCount: number;
        /** EventBulletDamage.AttackTickFrac */
        readonly attackTickFrac: number;
        /** EventBulletDamage.Attacker */
        readonly attacker: Player | null;
        /** EventBulletDamage.DamageDirX */
        readonly damageDirX: number;
        /** EventBulletDamage.DamageDirY */
        readonly damageDirY: number;
        /** EventBulletDamage.DamageDirZ */
        readonly damageDirZ: number;
        /** EventBulletDamage.Distance */
        readonly distance: number;
        /** EventBulletDamage.InAir */
        readonly inAir: boolean;
        /** EventBulletDamage.InaccuracyAir */
        readonly inaccuracyAir: number;
        /** EventBulletDamage.InaccuracyMove */
        readonly inaccuracyMove: number;
        /** EventBulletDamage.InaccuracyTotal */
        readonly inaccuracyTotal: number;
        /** EventBulletDamage.NoScope */
        readonly noScope: boolean;
        /** EventBulletDamage.NumPenetrations */
        readonly numPenetrations: number;
        /** EventBulletDamage.RecoilIndex */
        readonly recoilIndex: number;
        /** EventBulletDamage.RenderTickCount */
        readonly renderTickCount: number;
        /** EventBulletDamage.RenderTickFrac */
        readonly renderTickFrac: number;
        /** EventBulletDamage.ShootAngX */
        readonly shootAngX: number;
        /** EventBulletDamage.ShootAngY */
        readonly shootAngY: number;
        /** EventBulletDamage.ShootAngZ */
        readonly shootAngZ: number;
        /** EventBulletDamage.Type */
        readonly type: number;
        /** EventBulletDamage.Victim */
        readonly victim: Player | null;
    }

    /** What the `bullet_impact` event carries. */
    interface BulletImpactEvent {
        /** EventBulletImpact.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventBulletImpact.X */
        readonly x: number;
        /** EventBulletImpact.Y */
        readonly y: number;
        /** EventBulletImpact.Z */
        readonly z: number;
    }

    /** What the `buymenu_close` event carries. */
    interface BuymenuCloseEvent {
        /** EventBuymenuClose.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `buymenu_open` event carries. */
    interface BuymenuOpenEvent {
    }

    /** What the `buytime_ended` event carries. */
    interface BuytimeEndedEvent {
    }

    /** What the `cart_updated` event carries. */
    interface CartUpdatedEvent {
    }

    /** What the `choppers_incoming_warning` event carries. */
    interface ChoppersIncomingWarningEvent {
        /** EventChoppersIncomingWarning.Global */
        readonly global: boolean;
    }

    /** What the `client_disconnect` event carries. */
    interface ClientDisconnectEvent {
    }

    /** What the `client_loadout_changed` event carries. */
    interface ClientLoadoutChangedEvent {
    }

    /** What the `clientside_lesson_closed` event carries. */
    interface ClientsideLessonClosedEvent {
        /** EventClientsideLessonClosed.LessonName */
        readonly lessonName: string;
    }

    /** What the `clientside_reload_custom_econ` event carries. */
    interface ClientsideReloadCustomEconEvent {
        /** EventClientsideReloadCustomEcon.Steamid */
        readonly steamid: string;
    }

    /** What the `cs_game_disconnected` event carries. */
    interface CsGameDisconnectedEvent {
    }

    /** What the `cs_intermission` event carries. */
    interface CsIntermissionEvent {
    }

    /** What the `cs_match_end_restart` event carries. */
    interface CsMatchEndRestartEvent {
    }

    /** What the `cs_pre_restart` event carries. */
    interface CsPreRestartEvent {
    }

    /** What the `cs_prev_next_spectator` event carries. */
    interface CsPrevNextSpectatorEvent {
        /** EventCsPrevNextSpectator.Next */
        readonly next: boolean;
    }

    /** What the `cs_round_final_beep` event carries. */
    interface CsRoundFinalBeepEvent {
    }

    /** What the `cs_round_start_beep` event carries. */
    interface CsRoundStartBeepEvent {
    }

    /** What the `cs_win_panel_match` event carries. */
    interface CsWinPanelMatchEvent {
    }

    /** What the `cs_win_panel_round` event carries. */
    interface CsWinPanelRoundEvent {
        /** EventCsWinPanelRound.FinalEvent */
        readonly finalEvent: number;
        /** EventCsWinPanelRound.FunfactData1 */
        readonly funfactData1: number;
        /** EventCsWinPanelRound.FunfactData2 */
        readonly funfactData2: number;
        /** EventCsWinPanelRound.FunfactData3 */
        readonly funfactData3: number;
        /** EventCsWinPanelRound.FunfactPlayer */
        readonly funfactPlayer: Player | null;
        /** EventCsWinPanelRound.FunfactToken */
        readonly funfactToken: string;
        /** EventCsWinPanelRound.ShowTimerAttack */
        readonly showTimerAttack: boolean;
        /** EventCsWinPanelRound.ShowTimerDefend */
        readonly showTimerDefend: boolean;
        /** EventCsWinPanelRound.TimerTime */
        readonly timerTime: number;
    }

    /** What the `decoy_detonate` event carries. */
    interface DecoyDetonateEvent {
        /** EventDecoyDetonate.Entityid */
        readonly entityid: number;
        /** EventDecoyDetonate.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventDecoyDetonate.X */
        readonly x: number;
        /** EventDecoyDetonate.Y */
        readonly y: number;
        /** EventDecoyDetonate.Z */
        readonly z: number;
    }

    /** What the `decoy_firing` event carries. */
    interface DecoyFiringEvent {
        /** EventDecoyFiring.Entityid */
        readonly entityid: number;
        /** EventDecoyFiring.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventDecoyFiring.X */
        readonly x: number;
        /** EventDecoyFiring.Y */
        readonly y: number;
        /** EventDecoyFiring.Z */
        readonly z: number;
    }

    /** What the `decoy_started` event carries. */
    interface DecoyStartedEvent {
        /** EventDecoyStarted.Entityid */
        readonly entityid: number;
        /** EventDecoyStarted.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventDecoyStarted.X */
        readonly x: number;
        /** EventDecoyStarted.Y */
        readonly y: number;
        /** EventDecoyStarted.Z */
        readonly z: number;
    }

    /** What the `defuser_dropped` event carries. */
    interface DefuserDroppedEvent {
        /** EventDefuserDropped.Entityid */
        readonly entityid: number;
    }

    /** What the `defuser_pickup` event carries. */
    interface DefuserPickupEvent {
        /** EventDefuserPickup.Entityid */
        readonly entityid: number;
        /** EventDefuserPickup.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `demo_skip` event carries. */
    interface DemoSkipEvent {
        /** EventDemoSkip.DotaHeroChaseList */
        readonly dotaHeroChaseList: number;
        /** EventDemoSkip.Local */
        readonly local: number;
        /** EventDemoSkip.PlaybackTick */
        readonly playbackTick: number;
        /** EventDemoSkip.SkiptoTick */
        readonly skiptoTick: number;
        /** EventDemoSkip.UserMessageList */
        readonly userMessageList: number;
    }

    /** What the `demo_start` event carries. */
    interface DemoStartEvent {
        /** EventDemoStart.DotaCombatlogList */
        readonly dotaCombatlogList: number;
        /** EventDemoStart.DotaHeroChaseList */
        readonly dotaHeroChaseList: number;
        /** EventDemoStart.DotaPickHeroList */
        readonly dotaPickHeroList: number;
        /** EventDemoStart.Local */
        readonly local: number;
    }

    /** What the `demo_stop` event carries. */
    interface DemoStopEvent {
    }

    /** What the `difficulty_changed` event carries. */
    interface DifficultyChangedEvent {
        /** EventDifficultyChanged.Newdifficulty */
        readonly newdifficulty: number;
        /** EventDifficultyChanged.Olddifficulty */
        readonly olddifficulty: number;
        /** EventDifficultyChanged.Strdifficulty */
        readonly strdifficulty: string;
    }

    /** What the `dm_bonus_weapon_start` event carries. */
    interface DmBonusWeaponStartEvent {
        /** EventDmBonusWeaponStart.Pos */
        readonly pos: number;
        /** EventDmBonusWeaponStart.Time */
        readonly time: number;
    }

    /** What the `door_break` event carries. */
    interface DoorBreakEvent {
        /** EventDoorBreak.Dmgstate */
        readonly dmgstate: number;
        /** EventDoorBreak.Entindex */
        readonly entindex: number;
    }

    /** What the `door_close` event carries. */
    interface DoorCloseEvent {
        /** EventDoorClose.Checkpoint */
        readonly checkpoint: boolean;
        /** EventDoorClose.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `door_closed` event carries. */
    interface DoorClosedEvent {
        /** EventDoorClosed.Entindex */
        readonly entindex: number;
        /** EventDoorClosed.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `door_moving` event carries. */
    interface DoorMovingEvent {
        /** EventDoorMoving.Entindex */
        readonly entindex: number;
        /** EventDoorMoving.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `door_open` event carries. */
    interface DoorOpenEvent {
        /** EventDoorOpen.Entindex */
        readonly entindex: number;
        /** EventDoorOpen.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `drone_above_roof` event carries. */
    interface DroneAboveRoofEvent {
        /** EventDroneAboveRoof.Cargo */
        readonly cargo: number;
        /** EventDroneAboveRoof.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `drone_cargo_detached` event carries. */
    interface DroneCargoDetachedEvent {
        /** EventDroneCargoDetached.Cargo */
        readonly cargo: number;
        /** EventDroneCargoDetached.Delivered */
        readonly delivered: boolean;
        /** EventDroneCargoDetached.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `drone_dispatched` event carries. */
    interface DroneDispatchedEvent {
        /** EventDroneDispatched.DroneDispatchedParam */
        readonly droneDispatchedParam: number;
        /** EventDroneDispatched.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventDroneDispatched.Priority */
        readonly priority: number;
    }

    /** What the `dronegun_attack` event carries. */
    interface DronegunAttackEvent {
        /** EventDronegunAttack.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `drop_rate_modified` event carries. */
    interface DropRateModifiedEvent {
    }

    /** What the `dynamic_shadow_light_changed` event carries. */
    interface DynamicShadowLightChangedEvent {
    }

    /** What the `dz_item_interaction` event carries. */
    interface DzItemInteractionEvent {
        /** EventDzItemInteraction.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventDzItemInteraction.Subject */
        readonly subject: number;
        /** EventDzItemInteraction.Type */
        readonly type: string;
    }

    /** What the `enable_restart_voting` event carries. */
    interface EnableRestartVotingEvent {
        /** EventEnableRestartVoting.Enable */
        readonly enable: boolean;
    }

    /** What the `endmatch_cmm_start_reveal_items` event carries. */
    interface EndmatchCmmStartRevealItemsEvent {
    }

    /** What the `endmatch_mapvote_selecting_map` event carries. */
    interface EndmatchMapvoteSelectingMapEvent {
        /** EventEndmatchMapvoteSelectingMap.Count */
        readonly count: number;
        /** EventEndmatchMapvoteSelectingMap.Slot1 */
        readonly slot1: number;
        /** EventEndmatchMapvoteSelectingMap.Slot10 */
        readonly slot10: number;
        /** EventEndmatchMapvoteSelectingMap.Slot2 */
        readonly slot2: number;
        /** EventEndmatchMapvoteSelectingMap.Slot3 */
        readonly slot3: number;
        /** EventEndmatchMapvoteSelectingMap.Slot4 */
        readonly slot4: number;
        /** EventEndmatchMapvoteSelectingMap.Slot5 */
        readonly slot5: number;
        /** EventEndmatchMapvoteSelectingMap.Slot6 */
        readonly slot6: number;
        /** EventEndmatchMapvoteSelectingMap.Slot7 */
        readonly slot7: number;
        /** EventEndmatchMapvoteSelectingMap.Slot8 */
        readonly slot8: number;
        /** EventEndmatchMapvoteSelectingMap.Slot9 */
        readonly slot9: number;
    }

    /** What the `enter_bombzone` event carries. */
    interface EnterBombzoneEvent {
        /** EventEnterBombzone.Hasbomb */
        readonly hasbomb: boolean;
        /** EventEnterBombzone.Isplanted */
        readonly isplanted: boolean;
        /** EventEnterBombzone.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `enter_buyzone` event carries. */
    interface EnterBuyzoneEvent {
        /** EventEnterBuyzone.Canbuy */
        readonly canbuy: boolean;
        /** EventEnterBuyzone.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `enter_rescue_zone` event carries. */
    interface EnterRescueZoneEvent {
        /** EventEnterRescueZone.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `entity_killed` event carries. */
    interface EntityKilledEvent {
        /** EventEntityKilled.Damagebits */
        readonly damagebits: number;
        /** EventEntityKilled.EntindexAttacker */
        readonly entindexAttacker: number;
        /** EventEntityKilled.EntindexInflictor */
        readonly entindexInflictor: number;
        /** EventEntityKilled.EntindexKilled */
        readonly entindexKilled: number;
    }

    /** What the `entity_visible` event carries. */
    interface EntityVisibleEvent {
        /** EventEntityVisible.Classname */
        readonly classname: string;
        /** EventEntityVisible.Entityname */
        readonly entityname: string;
        /** EventEntityVisible.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventEntityVisible.Subject */
        readonly subject: number;
    }

    /** What the `event_ticket_modified` event carries. */
    interface EventTicketModifiedEvent {
    }

    /** What the `exit_bombzone` event carries. */
    interface ExitBombzoneEvent {
        /** EventExitBombzone.Hasbomb */
        readonly hasbomb: boolean;
        /** EventExitBombzone.Isplanted */
        readonly isplanted: boolean;
        /** EventExitBombzone.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `exit_buyzone` event carries. */
    interface ExitBuyzoneEvent {
        /** EventExitBuyzone.Canbuy */
        readonly canbuy: boolean;
        /** EventExitBuyzone.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `exit_rescue_zone` event carries. */
    interface ExitRescueZoneEvent {
        /** EventExitRescueZone.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `finale_start` event carries. */
    interface FinaleStartEvent {
        /** EventFinaleStart.Rushes */
        readonly rushes: number;
    }

    /** What the `firstbombs_incoming_warning` event carries. */
    interface FirstbombsIncomingWarningEvent {
        /** EventFirstbombsIncomingWarning.Global */
        readonly global: boolean;
    }

    /** What the `flare_ignite_npc` event carries. */
    interface FlareIgniteNpcEvent {
        /** EventFlareIgniteNpc.Entindex */
        readonly entindex: number;
    }

    /** What the `flashbang_detonate` event carries. */
    interface FlashbangDetonateEvent {
        /** EventFlashbangDetonate.Entityid */
        readonly entityid: number;
        /** EventFlashbangDetonate.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventFlashbangDetonate.X */
        readonly x: number;
        /** EventFlashbangDetonate.Y */
        readonly y: number;
        /** EventFlashbangDetonate.Z */
        readonly z: number;
    }

    /** What the `game_end` event carries. */
    interface GameEndEvent {
        /** EventGameEnd.Winner */
        readonly winner: number;
    }

    /** What the `game_init` event carries. */
    interface GameInitEvent {
    }

    /** What the `game_message` event carries. */
    interface GameMessageEvent {
        /** EventGameMessage.Target */
        readonly target: number;
        /** EventGameMessage.Text */
        readonly text: string;
    }

    /** What the `game_newmap` event carries. */
    interface GameNewmapEvent {
        /** EventGameNewmap.Mapname */
        readonly mapname: string;
        /** EventGameNewmap.Transition */
        readonly transition: boolean;
    }

    /** What the `game_phase_changed` event carries. */
    interface GamePhaseChangedEvent {
        /** EventGamePhaseChanged.NewPhase */
        readonly newPhase: number;
    }

    /** What the `game_start` event carries. */
    interface GameStartEvent {
        /** EventGameStart.Fraglimit */
        readonly fraglimit: number;
        /** EventGameStart.Objective */
        readonly objective: string;
        /** EventGameStart.Roundslimit */
        readonly roundslimit: number;
        /** EventGameStart.Timelimit */
        readonly timelimit: number;
    }

    /** What the `gameinstructor_draw` event carries. */
    interface GameinstructorDrawEvent {
    }

    /** What the `gameinstructor_nodraw` event carries. */
    interface GameinstructorNodrawEvent {
    }

    /** What the `gameui_hidden` event carries. */
    interface GameuiHiddenEvent {
    }

    /** What the `gc_connected` event carries. */
    interface GcConnectedEvent {
    }

    /** What the `gg_killed_enemy` event carries. */
    interface GgKilledEnemyEvent {
        /** EventGgKilledEnemy.Attackerid */
        readonly attackerid: Player | null;
        /** EventGgKilledEnemy.Bonus */
        readonly bonus: boolean;
        /** EventGgKilledEnemy.Dominated */
        readonly dominated: number;
        /** EventGgKilledEnemy.Revenge */
        readonly revenge: number;
        /** EventGgKilledEnemy.Victimid */
        readonly victimid: Player | null;
    }

    /** What the `grenade_bounce` event carries. */
    interface GrenadeBounceEvent {
        /** EventGrenadeBounce.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `grenade_thrown` event carries. */
    interface GrenadeThrownEvent {
        /** EventGrenadeThrown.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventGrenadeThrown.Weapon */
        readonly weapon: string;
    }

    /** What the `guardian_wave_restart` event carries. */
    interface GuardianWaveRestartEvent {
    }

    /** What the `hegrenade_detonate` event carries. */
    interface HegrenadeDetonateEvent {
        /** EventHegrenadeDetonate.Entityid */
        readonly entityid: number;
        /** EventHegrenadeDetonate.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventHegrenadeDetonate.X */
        readonly x: number;
        /** EventHegrenadeDetonate.Y */
        readonly y: number;
        /** EventHegrenadeDetonate.Z */
        readonly z: number;
    }

    /** What the `helicopter_grenade_punt_miss` event carries. */
    interface HelicopterGrenadePuntMissEvent {
    }

    /** What the `hide_deathpanel` event carries. */
    interface HideDeathpanelEvent {
    }

    /** What the `hltv_cameraman` event carries. */
    interface HltvCameramanEvent {
        /** EventHltvCameraman.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `hltv_changed_mode` event carries. */
    interface HltvChangedModeEvent {
        /** EventHltvChangedMode.Newmode */
        readonly newmode: number;
        /** EventHltvChangedMode.ObsTarget */
        readonly obsTarget: number;
        /** EventHltvChangedMode.Oldmode */
        readonly oldmode: number;
    }

    /** What the `hltv_chase` event carries. */
    interface HltvChaseEvent {
        /** EventHltvChase.Distance */
        readonly distance: number;
        /** EventHltvChase.Inertia */
        readonly inertia: number;
        /** EventHltvChase.Ineye */
        readonly ineye: number;
        /** EventHltvChase.Phi */
        readonly phi: number;
        /** EventHltvChase.Target1 */
        readonly target1: Player | null;
        /** EventHltvChase.Target2 */
        readonly target2: Player | null;
        /** EventHltvChase.Theta */
        readonly theta: number;
    }

    /** What the `hltv_chat` event carries. */
    interface HltvChatEvent {
        /** EventHltvChat.Steamid — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly steamid: string;
        /** EventHltvChat.Text */
        readonly text: string;
    }

    /** What the `hltv_fixed` event carries. */
    interface HltvFixedEvent {
        /** EventHltvFixed.Fov */
        readonly fov: number;
        /** EventHltvFixed.Offset */
        readonly offset: number;
        /** EventHltvFixed.Phi */
        readonly phi: number;
        /** EventHltvFixed.Posx */
        readonly posx: number;
        /** EventHltvFixed.Posy */
        readonly posy: number;
        /** EventHltvFixed.Posz */
        readonly posz: number;
        /** EventHltvFixed.Target */
        readonly target: Player | null;
        /** EventHltvFixed.Theta */
        readonly theta: number;
    }

    /** What the `hltv_message` event carries. */
    interface HltvMessageEvent {
        /** EventHltvMessage.Text */
        readonly text: string;
    }

    /** What the `hltv_rank_camera` event carries. */
    interface HltvRankCameraEvent {
        /** EventHltvRankCamera.Index */
        readonly index: number;
        /** EventHltvRankCamera.Rank */
        readonly rank: number;
        /** EventHltvRankCamera.Target */
        readonly target: Player | null;
    }

    /** What the `hltv_rank_entity` event carries. */
    interface HltvRankEntityEvent {
        /** EventHltvRankEntity.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventHltvRankEntity.Rank */
        readonly rank: number;
        /** EventHltvRankEntity.Target */
        readonly target: Player | null;
    }

    /** What the `hltv_replay` event carries. */
    interface HltvReplayEvent {
        /** EventHltvReplay.Delay */
        readonly delay: number;
        /** EventHltvReplay.Reason */
        readonly reason: number;
    }

    /** What the `hltv_replay_status` event carries. */
    interface HltvReplayStatusEvent {
        /** EventHltvReplayStatus.Reason */
        readonly reason: number;
    }

    /** What the `hltv_status` event carries. */
    interface HltvStatusEvent {
        /** EventHltvStatus.Clients */
        readonly clients: number;
        /** EventHltvStatus.Master */
        readonly master: string;
        /** EventHltvStatus.Proxies */
        readonly proxies: number;
        /** EventHltvStatus.Slots */
        readonly slots: number;
    }

    /** What the `hltv_title` event carries. */
    interface HltvTitleEvent {
        /** EventHltvTitle.Text */
        readonly text: string;
    }

    /** What the `hltv_versioninfo` event carries. */
    interface HltvVersioninfoEvent {
        /** EventHltvVersioninfo.Version */
        readonly version: number;
    }

    /** What the `hostage_call_for_help` event carries. */
    interface HostageCallForHelpEvent {
        /** EventHostageCallForHelp.Hostage */
        readonly hostage: number;
    }

    /** What the `hostage_follows` event carries. */
    interface HostageFollowsEvent {
        /** EventHostageFollows.Hostage */
        readonly hostage: number;
        /** EventHostageFollows.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `hostage_hurt` event carries. */
    interface HostageHurtEvent {
        /** EventHostageHurt.Hostage */
        readonly hostage: number;
        /** EventHostageHurt.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `hostage_killed` event carries. */
    interface HostageKilledEvent {
        /** EventHostageKilled.Hostage */
        readonly hostage: number;
        /** EventHostageKilled.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `hostage_rescued` event carries. */
    interface HostageRescuedEvent {
        /** EventHostageRescued.Hostage */
        readonly hostage: number;
        /** EventHostageRescued.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventHostageRescued.Site */
        readonly site: number;
    }

    /** What the `hostage_rescued_all` event carries. */
    interface HostageRescuedAllEvent {
    }

    /** What the `hostage_stops_following` event carries. */
    interface HostageStopsFollowingEvent {
        /** EventHostageStopsFollowing.Hostage */
        readonly hostage: number;
        /** EventHostageStopsFollowing.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `hostname_changed` event carries. */
    interface HostnameChangedEvent {
        /** EventHostnameChanged.Hostname */
        readonly hostname: string;
    }

    /** What the `inferno_expire` event carries. */
    interface InfernoExpireEvent {
        /** EventInfernoExpire.Entityid */
        readonly entityid: number;
        /** EventInfernoExpire.X */
        readonly x: number;
        /** EventInfernoExpire.Y */
        readonly y: number;
        /** EventInfernoExpire.Z */
        readonly z: number;
    }

    /** What the `inferno_extinguish` event carries. */
    interface InfernoExtinguishEvent {
        /** EventInfernoExtinguish.Entityid */
        readonly entityid: number;
        /** EventInfernoExtinguish.X */
        readonly x: number;
        /** EventInfernoExtinguish.Y */
        readonly y: number;
        /** EventInfernoExtinguish.Z */
        readonly z: number;
    }

    /** What the `inferno_startburn` event carries. */
    interface InfernoStartburnEvent {
        /** EventInfernoStartburn.Entityid */
        readonly entityid: number;
        /** EventInfernoStartburn.X */
        readonly x: number;
        /** EventInfernoStartburn.Y */
        readonly y: number;
        /** EventInfernoStartburn.Z */
        readonly z: number;
    }

    /** What the `inspect_weapon` event carries. */
    interface InspectWeaponEvent {
        /** EventInspectWeapon.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `instructor_close_lesson` event carries. */
    interface InstructorCloseLessonEvent {
        /** EventInstructorCloseLesson.HintName */
        readonly hintName: string;
        /** EventInstructorCloseLesson.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `instructor_server_hint_create` event carries. */
    interface InstructorServerHintCreateEvent {
        /** EventInstructorServerHintCreate.HintActivatorCaption */
        readonly hintActivatorCaption: string;
        /** EventInstructorServerHintCreate.HintActivatorUserid */
        readonly hintActivatorUserid: Player | null;
        /** EventInstructorServerHintCreate.HintAllowNodrawTarget */
        readonly hintAllowNodrawTarget: boolean;
        /** EventInstructorServerHintCreate.HintBinding */
        readonly hintBinding: string;
        /** EventInstructorServerHintCreate.HintCaption */
        readonly hintCaption: string;
        /** EventInstructorServerHintCreate.HintColor */
        readonly hintColor: string;
        /** EventInstructorServerHintCreate.HintEntindex */
        readonly hintEntindex: number;
        /** EventInstructorServerHintCreate.HintFlags */
        readonly hintFlags: number;
        /** EventInstructorServerHintCreate.HintForcecaption */
        readonly hintForcecaption: boolean;
        /** EventInstructorServerHintCreate.HintGamepadBinding */
        readonly hintGamepadBinding: string;
        /** EventInstructorServerHintCreate.HintIconOffscreen */
        readonly hintIconOffscreen: string;
        /** EventInstructorServerHintCreate.HintIconOffset */
        readonly hintIconOffset: number;
        /** EventInstructorServerHintCreate.HintIconOnscreen */
        readonly hintIconOnscreen: string;
        /** EventInstructorServerHintCreate.HintLayoutfile */
        readonly hintLayoutfile: string;
        /** EventInstructorServerHintCreate.HintLocalPlayerOnly */
        readonly hintLocalPlayerOnly: boolean;
        /** EventInstructorServerHintCreate.HintName */
        readonly hintName: string;
        /** EventInstructorServerHintCreate.HintNooffscreen */
        readonly hintNooffscreen: boolean;
        /** EventInstructorServerHintCreate.HintRange */
        readonly hintRange: number;
        /** EventInstructorServerHintCreate.HintReplaceKey */
        readonly hintReplaceKey: string;
        /** EventInstructorServerHintCreate.HintStartSound */
        readonly hintStartSound: string;
        /** EventInstructorServerHintCreate.HintTarget */
        readonly hintTarget: number;
        /** EventInstructorServerHintCreate.HintTimeout */
        readonly hintTimeout: number;
        /** EventInstructorServerHintCreate.HintVrHeightOffset */
        readonly hintVrHeightOffset: number;
        /** EventInstructorServerHintCreate.HintVrOffsetX */
        readonly hintVrOffsetX: number;
        /** EventInstructorServerHintCreate.HintVrOffsetY */
        readonly hintVrOffsetY: number;
        /** EventInstructorServerHintCreate.HintVrOffsetZ */
        readonly hintVrOffsetZ: number;
        /** EventInstructorServerHintCreate.HintVrPanelType */
        readonly hintVrPanelType: number;
        /** EventInstructorServerHintCreate.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `instructor_server_hint_stop` event carries. */
    interface InstructorServerHintStopEvent {
        /** EventInstructorServerHintStop.HintEntindex */
        readonly hintEntindex: number;
        /** EventInstructorServerHintStop.HintName */
        readonly hintName: string;
    }

    /** What the `instructor_start_lesson` event carries. */
    interface InstructorStartLessonEvent {
        /** EventInstructorStartLesson.HintName */
        readonly hintName: string;
        /** EventInstructorStartLesson.HintTarget */
        readonly hintTarget: number;
        /** EventInstructorStartLesson.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventInstructorStartLesson.VrControllerType */
        readonly vrControllerType: number;
        /** EventInstructorStartLesson.VrMovementType */
        readonly vrMovementType: number;
        /** EventInstructorStartLesson.VrSingleController */
        readonly vrSingleController: boolean;
    }

    /** What the `inventory_updated` event carries. */
    interface InventoryUpdatedEvent {
        /** EventInventoryUpdated.Itemdef */
        readonly itemdef: number;
        /** EventInventoryUpdated.Itemid */
        readonly itemid: number;
    }

    /** What the `item_equip` event carries. */
    interface ItemEquipEvent {
        /** EventItemEquip.Canzoom */
        readonly canzoom: boolean;
        /** EventItemEquip.Defindex */
        readonly defindex: number;
        /** EventItemEquip.Hassilencer */
        readonly hassilencer: boolean;
        /** EventItemEquip.Hastracers */
        readonly hastracers: boolean;
        /** EventItemEquip.Ispainted */
        readonly ispainted: boolean;
        /** EventItemEquip.Issilenced */
        readonly issilenced: boolean;
        /** EventItemEquip.Item */
        readonly item: string;
        /** EventItemEquip.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventItemEquip.Weptype */
        readonly weptype: number;
    }

    /** What the `item_pickup` event carries. */
    interface ItemPickupEvent {
        /** EventItemPickup.Defindex */
        readonly defindex: number;
        /** EventItemPickup.Item */
        readonly item: string;
        /** EventItemPickup.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventItemPickup.Silent */
        readonly silent: boolean;
    }

    /** What the `item_pickup_failed` event carries. */
    interface ItemPickupFailedEvent {
        /** EventItemPickupFailed.Item */
        readonly item: string;
        /** EventItemPickupFailed.Limit */
        readonly limit: number;
        /** EventItemPickupFailed.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventItemPickupFailed.Reason */
        readonly reason: number;
    }

    /** What the `item_pickup_slerp` event carries. */
    interface ItemPickupSlerpEvent {
        /** EventItemPickupSlerp.Behavior */
        readonly behavior: number;
        /** EventItemPickupSlerp.Index */
        readonly index: number;
        /** EventItemPickupSlerp.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `item_purchase` event carries. */
    interface ItemPurchaseEvent {
        /** EventItemPurchase.Loadout */
        readonly loadout: number;
        /** EventItemPurchase.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventItemPurchase.Team */
        readonly team: number;
        /** EventItemPurchase.Weapon */
        readonly weapon: string;
    }

    /** What the `item_remove` event carries. */
    interface ItemRemoveEvent {
        /** EventItemRemove.Defindex */
        readonly defindex: number;
        /** EventItemRemove.Item */
        readonly item: string;
        /** EventItemRemove.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `item_schema_initialized` event carries. */
    interface ItemSchemaInitializedEvent {
    }

    /** What the `jointeam_failed` event carries. */
    interface JointeamFailedEvent {
        /** EventJointeamFailed.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventJointeamFailed.Reason */
        readonly reason: number;
    }

    /** What the `local_player_controller_team` event carries. */
    interface LocalPlayerControllerTeamEvent {
    }

    /** What the `local_player_pawn_changed` event carries. */
    interface LocalPlayerPawnChangedEvent {
    }

    /** What the `local_player_team` event carries. */
    interface LocalPlayerTeamEvent {
    }

    /** What the `loot_crate_opened` event carries. */
    interface LootCrateOpenedEvent {
        /** EventLootCrateOpened.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventLootCrateOpened.Type */
        readonly type: string;
    }

    /** What the `loot_crate_visible` event carries. */
    interface LootCrateVisibleEvent {
        /** EventLootCrateVisible.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventLootCrateVisible.Subject */
        readonly subject: number;
        /** EventLootCrateVisible.Type */
        readonly type: string;
    }

    /** What the `map_shutdown` event carries. */
    interface MapShutdownEvent {
    }

    /** What the `map_transition` event carries. */
    interface MapTransitionEvent {
    }

    /** What the `match_end_conditions` event carries. */
    interface MatchEndConditionsEvent {
        /** EventMatchEndConditions.Frags */
        readonly frags: number;
        /** EventMatchEndConditions.MaxRounds */
        readonly maxRounds: number;
        /** EventMatchEndConditions.Time */
        readonly time: number;
        /** EventMatchEndConditions.WinRounds */
        readonly winRounds: number;
    }

    /** What the `material_default_complete` event carries. */
    interface MaterialDefaultCompleteEvent {
    }

    /** What the `mb_input_lock_cancel` event carries. */
    interface MbInputLockCancelEvent {
    }

    /** What the `mb_input_lock_success` event carries. */
    interface MbInputLockSuccessEvent {
    }

    /** What the `molotov_detonate` event carries. */
    interface MolotovDetonateEvent {
        /** EventMolotovDetonate.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventMolotovDetonate.X */
        readonly x: number;
        /** EventMolotovDetonate.Y */
        readonly y: number;
        /** EventMolotovDetonate.Z */
        readonly z: number;
    }

    /** What the `nav_blocked` event carries. */
    interface NavBlockedEvent {
        /** EventNavBlocked.Area */
        readonly area: number;
        /** EventNavBlocked.Blocked */
        readonly blocked: boolean;
    }

    /** What the `nav_generate` event carries. */
    interface NavGenerateEvent {
    }

    /** What the `nextlevel_changed` event carries. */
    interface NextlevelChangedEvent {
        /** EventNextlevelChanged.Mapgroup */
        readonly mapgroup: string;
        /** EventNextlevelChanged.Nextlevel */
        readonly nextlevel: string;
        /** EventNextlevelChanged.Skirmishmode */
        readonly skirmishmode: string;
    }

    /** What the `open_crate_instr` event carries. */
    interface OpenCrateInstrEvent {
        /** EventOpenCrateInstr.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventOpenCrateInstr.Subject */
        readonly subject: number;
        /** EventOpenCrateInstr.Type */
        readonly type: string;
    }

    /** What the `other_death` event carries. */
    interface OtherDeathEvent {
        /** EventOtherDeath.Attacker */
        readonly attacker: number;
        /** EventOtherDeath.Attackerblind */
        readonly attackerblind: boolean;
        /** EventOtherDeath.Headshot */
        readonly headshot: boolean;
        /** EventOtherDeath.Noscope */
        readonly noscope: boolean;
        /** EventOtherDeath.Otherid */
        readonly otherid: number;
        /** EventOtherDeath.Othertype */
        readonly othertype: string;
        /** EventOtherDeath.Penetrated */
        readonly penetrated: number;
        /** EventOtherDeath.Thrusmoke */
        readonly thrusmoke: boolean;
        /** EventOtherDeath.Weapon */
        readonly weapon: string;
        /** EventOtherDeath.WeaponFauxitemid */
        readonly weaponFauxitemid: string;
        /** EventOtherDeath.WeaponItemid */
        readonly weaponItemid: string;
        /** EventOtherDeath.WeaponOriginalownerXuid */
        readonly weaponOriginalownerXuid: string;
    }

    /** What the `parachute_deploy` event carries. */
    interface ParachuteDeployEvent {
        /** EventParachuteDeploy.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `parachute_pickup` event carries. */
    interface ParachutePickupEvent {
        /** EventParachutePickup.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `physgun_pickup` event carries. */
    interface PhysgunPickupEvent {
    }

    /** What the `player_activate` event carries. */
    interface PlayerActivateEvent {
        /** EventPlayerActivate.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `player_avenged_teammate` event carries. */
    interface PlayerAvengedTeammateEvent {
        /** EventPlayerAvengedTeammate.AvengedPlayerId */
        readonly avengedPlayerId: Player | null;
        /** EventPlayerAvengedTeammate.AvengerId */
        readonly avengerId: Player | null;
    }

    /** What the `player_blind` event carries. */
    interface PlayerBlindEvent {
        /** EventPlayerBlind.Attacker */
        readonly attacker: Player | null;
        /** EventPlayerBlind.BlindDuration */
        readonly blindDuration: number;
        /** EventPlayerBlind.Entityid */
        readonly entityid: number;
        /** EventPlayerBlind.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `player_changename` event carries. */
    interface PlayerChangenameEvent {
        /** EventPlayerChangename.Newname */
        readonly newname: string;
        /** EventPlayerChangename.Oldname */
        readonly oldname: string;
        /** EventPlayerChangename.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `player_chat` event carries. */
    interface PlayerChatEvent {
        /** EventPlayerChat.Userid */
        readonly player: number;
        /** EventPlayerChat.Teamonly */
        readonly teamonly: boolean;
        /** EventPlayerChat.Text */
        readonly text: string;
    }

    /** What the `player_connect` event carries. */
    interface PlayerConnectEvent {
        /** EventPlayerConnect.Bot */
        readonly bot: boolean;
        /** EventPlayerConnect.Name */
        readonly name: string;
        /** EventPlayerConnect.Networkid */
        readonly networkid: string;
        /** EventPlayerConnect.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventPlayerConnect.Xuid — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly xuid: string;
    }

    /** What the `player_connect_full` event carries. */
    interface PlayerConnectFullEvent {
        /** EventPlayerConnectFull.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `player_death` event carries. */
    interface PlayerDeathEvent {
        /** EventPlayerDeath.Assistedflash */
        readonly assistedflash: boolean;
        /** EventPlayerDeath.Assister */
        readonly assister: Player | null;
        /** EventPlayerDeath.Attacker */
        readonly attacker: Player | null;
        /** EventPlayerDeath.Attackerblind */
        readonly attackerblind: boolean;
        /** EventPlayerDeath.Attackerinair */
        readonly attackerinair: boolean;
        /** EventPlayerDeath.Distance */
        readonly distance: number;
        /** EventPlayerDeath.DmgArmor */
        readonly dmgArmor: number;
        /** EventPlayerDeath.DmgHealth */
        readonly dmgHealth: number;
        /** EventPlayerDeath.Dominated */
        readonly dominated: number;
        /** EventPlayerDeath.Headshot */
        readonly headshot: boolean;
        /** EventPlayerDeath.Hitgroup */
        readonly hitgroup: number;
        /** EventPlayerDeath.Noreplay */
        readonly noreplay: boolean;
        /** EventPlayerDeath.Noscope */
        readonly noscope: boolean;
        /** EventPlayerDeath.Penetrated */
        readonly penetrated: number;
        /** EventPlayerDeath.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventPlayerDeath.Revenge */
        readonly revenge: number;
        /** EventPlayerDeath.Thrusmoke */
        readonly thrusmoke: boolean;
        /** EventPlayerDeath.Weapon */
        readonly weapon: string;
        /** EventPlayerDeath.WeaponFauxitemid */
        readonly weaponFauxitemid: string;
        /** EventPlayerDeath.WeaponItemid */
        readonly weaponItemid: string;
        /** EventPlayerDeath.WeaponOriginalownerXuid */
        readonly weaponOriginalownerXuid: string;
        /** EventPlayerDeath.Wipe */
        readonly wipe: number;
    }

    /** What the `player_decal` event carries. */
    interface PlayerDecalEvent {
        /** EventPlayerDecal.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `player_disconnect` event carries. */
    interface PlayerDisconnectEvent {
        /** EventPlayerDisconnect.EverFullyConnected */
        readonly everFullyConnected: boolean;
        /** EventPlayerDisconnect.Name */
        readonly name: string;
        /** EventPlayerDisconnect.Networkid */
        readonly networkid: string;
        /** EventPlayerDisconnect.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventPlayerDisconnect.Playerid */
        readonly playerid: number;
        /** EventPlayerDisconnect.Reason */
        readonly reason: number;
        /** EventPlayerDisconnect.Xuid — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly xuid: string;
    }

    /** What the `player_falldamage` event carries. */
    interface PlayerFalldamageEvent {
        /** EventPlayerFalldamage.Damage */
        readonly damage: number;
        /** EventPlayerFalldamage.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `player_footstep` event carries. */
    interface PlayerFootstepEvent {
        /** EventPlayerFootstep.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `player_full_update` event carries. */
    interface PlayerFullUpdateEvent {
        /** EventPlayerFullUpdate.Count */
        readonly count: number;
        /** EventPlayerFullUpdate.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `player_given_c4` event carries. */
    interface PlayerGivenC4Event {
        /** EventPlayerGivenC4.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `player_hintmessage` event carries. */
    interface PlayerHintmessageEvent {
        /** EventPlayerHintmessage.Hintmessage */
        readonly hintmessage: string;
    }

    /** What the `player_hurt` event carries. */
    interface PlayerHurtEvent {
        /** EventPlayerHurt.Armor */
        readonly armor: number;
        /** EventPlayerHurt.Attacker */
        readonly attacker: Player | null;
        /** EventPlayerHurt.DmgArmor */
        readonly dmgArmor: number;
        /** EventPlayerHurt.DmgHealth */
        readonly dmgHealth: number;
        /** EventPlayerHurt.Health */
        readonly health: number;
        /** EventPlayerHurt.Hitgroup */
        readonly hitgroup: number;
        /** EventPlayerHurt.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventPlayerHurt.Weapon */
        readonly weapon: string;
    }

    /** What the `player_info` event carries. */
    interface PlayerInfoEvent {
        /** EventPlayerInfo.Bot */
        readonly bot: boolean;
        /** EventPlayerInfo.Name */
        readonly name: string;
        /** EventPlayerInfo.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventPlayerInfo.Steamid — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly steamid: string;
    }

    /** What the `player_jump` event carries. */
    interface PlayerJumpEvent {
        /** EventPlayerJump.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `player_ping` event carries. */
    interface PlayerPingEvent {
        /** EventPlayerPing.Entityid */
        readonly entityid: number;
        /** EventPlayerPing.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventPlayerPing.Urgent */
        readonly urgent: boolean;
        /** EventPlayerPing.X */
        readonly x: number;
        /** EventPlayerPing.Y */
        readonly y: number;
        /** EventPlayerPing.Z */
        readonly z: number;
    }

    /** What the `player_ping_stop` event carries. */
    interface PlayerPingStopEvent {
        /** EventPlayerPingStop.Entityid */
        readonly entityid: number;
    }

    /** What the `player_radio` event carries. */
    interface PlayerRadioEvent {
        /** EventPlayerRadio.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventPlayerRadio.Slot */
        readonly slot: number;
    }

    /** What the `player_reset_vote` event carries. */
    interface PlayerResetVoteEvent {
        /** EventPlayerResetVote.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventPlayerResetVote.Vote */
        readonly vote: boolean;
    }

    /** What the `player_score` event carries. */
    interface PlayerScoreEvent {
        /** EventPlayerScore.Deaths */
        readonly deaths: number;
        /** EventPlayerScore.Kills */
        readonly kills: number;
        /** EventPlayerScore.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventPlayerScore.Score */
        readonly score: number;
    }

    /** What the `player_shoot` event carries. */
    interface PlayerShootEvent {
        /** EventPlayerShoot.Mode */
        readonly mode: number;
        /** EventPlayerShoot.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventPlayerShoot.Weapon */
        readonly weapon: number;
    }

    /** What the `player_sound` event carries. */
    interface PlayerSoundEvent {
        /** EventPlayerSound.Duration */
        readonly duration: number;
        /** EventPlayerSound.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventPlayerSound.Radius */
        readonly radius: number;
        /** EventPlayerSound.Step */
        readonly step: boolean;
    }

    /** What the `player_spawn` event carries. */
    interface PlayerSpawnEvent {
        /** EventPlayerSpawn.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `player_spawned` event carries. */
    interface PlayerSpawnedEvent {
        /** EventPlayerSpawned.Inrestart */
        readonly inrestart: boolean;
        /** EventPlayerSpawned.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `player_stats_updated` event carries. */
    interface PlayerStatsUpdatedEvent {
        /** EventPlayerStatsUpdated.Forceupload */
        readonly forceupload: boolean;
    }

    /** What the `player_team` event carries. */
    interface PlayerTeamEvent {
        /** EventPlayerTeam.Disconnect */
        readonly disconnect: boolean;
        /** EventPlayerTeam.Isbot */
        readonly isbot: boolean;
        /** EventPlayerTeam.Name */
        readonly name: string;
        /** EventPlayerTeam.Oldteam */
        readonly oldteam: number;
        /** EventPlayerTeam.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventPlayerTeam.Silent */
        readonly silent: boolean;
        /** EventPlayerTeam.Team */
        readonly team: number;
    }

    /** What the `ragdoll_dissolved` event carries. */
    interface RagdollDissolvedEvent {
        /** EventRagdollDissolved.Entindex */
        readonly entindex: number;
    }

    /** What the `read_game_titledata` event carries. */
    interface ReadGameTitledataEvent {
        /** EventReadGameTitledata.Controllerid */
        readonly controllerid: number;
    }

    /** What the `repost_xbox_achievements` event carries. */
    interface RepostXboxAchievementsEvent {
        /** EventRepostXboxAchievements.Splitscreenplayer */
        readonly splitscreenplayer: number;
    }

    /** What the `reset_game_titledata` event carries. */
    interface ResetGameTitledataEvent {
        /** EventResetGameTitledata.Controllerid */
        readonly controllerid: number;
    }

    /** What the `round_announce_final` event carries. */
    interface RoundAnnounceFinalEvent {
    }

    /** What the `round_announce_last_round_half` event carries. */
    interface RoundAnnounceLastRoundHalfEvent {
    }

    /** What the `round_announce_match_point` event carries. */
    interface RoundAnnounceMatchPointEvent {
    }

    /** What the `round_announce_match_start` event carries. */
    interface RoundAnnounceMatchStartEvent {
    }

    /** What the `round_announce_warmup` event carries. */
    interface RoundAnnounceWarmupEvent {
    }

    /** What the `round_end` event carries. */
    interface RoundEndEvent {
        /** EventRoundEnd.Legacy */
        readonly legacy: number;
        /** EventRoundEnd.Message */
        readonly message: string;
        /** EventRoundEnd.Nomusic */
        readonly nomusic: number;
        /** EventRoundEnd.PlayerCount */
        readonly playerCount: number;
        /** EventRoundEnd.Reason */
        readonly reason: number;
        /** EventRoundEnd.Time */
        readonly time: number;
        /** EventRoundEnd.Winner */
        readonly winner: number;
    }

    /** What the `round_end_upload_stats` event carries. */
    interface RoundEndUploadStatsEvent {
    }

    /** What the `round_freeze_end` event carries. */
    interface RoundFreezeEndEvent {
    }

    /** What the `round_mvp` event carries. */
    interface RoundMvpEvent {
        /** EventRoundMvp.Musickitid */
        readonly musickitid: number;
        /** EventRoundMvp.Musickitmvps */
        readonly musickitmvps: number;
        /** EventRoundMvp.Nomusic */
        readonly nomusic: number;
        /** EventRoundMvp.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventRoundMvp.Reason */
        readonly reason: number;
        /** EventRoundMvp.Value */
        readonly value: number;
    }

    /** What the `round_officially_ended` event carries. */
    interface RoundOfficiallyEndedEvent {
    }

    /** What the `round_poststart` event carries. */
    interface RoundPoststartEvent {
    }

    /** What the `round_prestart` event carries. */
    interface RoundPrestartEvent {
    }

    /** What the `round_start` event carries. */
    interface RoundStartEvent {
        /** EventRoundStart.Fraglimit */
        readonly fraglimit: number;
        /** EventRoundStart.Objective */
        readonly objective: string;
        /** EventRoundStart.Timelimit */
        readonly timelimit: number;
    }

    /** What the `round_start_post_nav` event carries. */
    interface RoundStartPostNavEvent {
    }

    /** What the `round_start_pre_entity` event carries. */
    interface RoundStartPreEntityEvent {
    }

    /** What the `round_time_warning` event carries. */
    interface RoundTimeWarningEvent {
    }

    /** What the `seasoncoin_levelup` event carries. */
    interface SeasoncoinLevelupEvent {
        /** EventSeasoncoinLevelup.Category */
        readonly category: number;
        /** EventSeasoncoinLevelup.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventSeasoncoinLevelup.Rank */
        readonly rank: number;
    }

    /** What the `server_cvar` event carries. */
    interface ServerCvarEvent {
        /** EventServerCvar.Cvarname */
        readonly cvarname: string;
        /** EventServerCvar.Cvarvalue */
        readonly cvarvalue: string;
    }

    /** What the `server_message` event carries. */
    interface ServerMessageEvent {
        /** EventServerMessage.Text */
        readonly text: string;
    }

    /** What the `server_pre_shutdown` event carries. */
    interface ServerPreShutdownEvent {
        /** EventServerPreShutdown.Reason */
        readonly reason: string;
    }

    /** What the `server_shutdown` event carries. */
    interface ServerShutdownEvent {
        /** EventServerShutdown.Reason */
        readonly reason: string;
    }

    /** What the `server_spawn` event carries. */
    interface ServerSpawnEvent {
        /** EventServerSpawn.Addonname */
        readonly addonname: string;
        /** EventServerSpawn.Address */
        readonly address: string;
        /** EventServerSpawn.Dedicated */
        readonly dedicated: boolean;
        /** EventServerSpawn.Game */
        readonly game: string;
        /** EventServerSpawn.Hostname */
        readonly hostname: string;
        /** EventServerSpawn.Mapname */
        readonly mapname: string;
        /** EventServerSpawn.Maxplayers */
        readonly maxplayers: number;
        /** EventServerSpawn.Os */
        readonly os: string;
        /** EventServerSpawn.Password */
        readonly password: boolean;
        /** EventServerSpawn.Port */
        readonly port: number;
    }

    /** What the `set_instructor_group_enabled` event carries. */
    interface SetInstructorGroupEnabledEvent {
        /** EventSetInstructorGroupEnabled.Enabled */
        readonly enabled: number;
        /** EventSetInstructorGroupEnabled.Group */
        readonly group: string;
    }

    /** What the `sfuievent` event carries. */
    interface SfuieventEvent {
        /** EventSfuievent.Action */
        readonly action: string;
        /** EventSfuievent.Data */
        readonly data: string;
        /** EventSfuievent.Slot */
        readonly slot: number;
    }

    /** What the `show_deathpanel` event carries. */
    interface ShowDeathpanelEvent {
        /** EventShowDeathpanel.DamageGiven */
        readonly damageGiven: number;
        /** EventShowDeathpanel.DamageTaken */
        readonly damageTaken: number;
        /** EventShowDeathpanel.HitsGiven */
        readonly hitsGiven: number;
        /** EventShowDeathpanel.HitsTaken */
        readonly hitsTaken: number;
        /** EventShowDeathpanel.KillerController */
        readonly killerController: Player | null;
        /** EventShowDeathpanel.Victim */
        readonly victim: Player | null;
    }

    /** What the `show_survival_respawn_status` event carries. */
    interface ShowSurvivalRespawnStatusEvent {
        /** EventShowSurvivalRespawnStatus.Duration */
        readonly duration: number;
        /** EventShowSurvivalRespawnStatus.LocToken */
        readonly locToken: string;
        /** EventShowSurvivalRespawnStatus.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `silencer_detach` event carries. */
    interface SilencerDetachEvent {
        /** EventSilencerDetach.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `silencer_off` event carries. */
    interface SilencerOffEvent {
        /** EventSilencerOff.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `silencer_on` event carries. */
    interface SilencerOnEvent {
        /** EventSilencerOn.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `smoke_beacon_paradrop` event carries. */
    interface SmokeBeaconParadropEvent {
        /** EventSmokeBeaconParadrop.Paradrop */
        readonly paradrop: number;
        /** EventSmokeBeaconParadrop.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `smokegrenade_detonate` event carries. */
    interface SmokegrenadeDetonateEvent {
        /** EventSmokegrenadeDetonate.Entityid */
        readonly entityid: number;
        /** EventSmokegrenadeDetonate.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventSmokegrenadeDetonate.X */
        readonly x: number;
        /** EventSmokegrenadeDetonate.Y */
        readonly y: number;
        /** EventSmokegrenadeDetonate.Z */
        readonly z: number;
    }

    /** What the `smokegrenade_expired` event carries. */
    interface SmokegrenadeExpiredEvent {
        /** EventSmokegrenadeExpired.Entityid */
        readonly entityid: number;
        /** EventSmokegrenadeExpired.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventSmokegrenadeExpired.X */
        readonly x: number;
        /** EventSmokegrenadeExpired.Y */
        readonly y: number;
        /** EventSmokegrenadeExpired.Z */
        readonly z: number;
    }

    /** What the `spec_mode_updated` event carries. */
    interface SpecModeUpdatedEvent {
        /** EventSpecModeUpdated.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `spec_target_updated` event carries. */
    interface SpecTargetUpdatedEvent {
        /** EventSpecTargetUpdated.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `start_halftime` event carries. */
    interface StartHalftimeEvent {
    }

    /** What the `start_vote` event carries. */
    interface StartVoteEvent {
        /** EventStartVote.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventStartVote.Type */
        readonly type: number;
        /** EventStartVote.VoteParameter */
        readonly voteParameter: number;
    }

    /** What the `store_pricesheet_updated` event carries. */
    interface StorePricesheetUpdatedEvent {
    }

    /** What the `survival_announce_phase` event carries. */
    interface SurvivalAnnouncePhaseEvent {
        /** EventSurvivalAnnouncePhase.Phase */
        readonly phase: number;
    }

    /** What the `survival_no_respawns_final` event carries. */
    interface SurvivalNoRespawnsFinalEvent {
        /** EventSurvivalNoRespawnsFinal.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `survival_no_respawns_warning` event carries. */
    interface SurvivalNoRespawnsWarningEvent {
        /** EventSurvivalNoRespawnsWarning.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `survival_paradrop_break` event carries. */
    interface SurvivalParadropBreakEvent {
        /** EventSurvivalParadropBreak.Entityid */
        readonly entityid: number;
    }

    /** What the `survival_paradrop_spawn` event carries. */
    interface SurvivalParadropSpawnEvent {
        /** EventSurvivalParadropSpawn.Entityid */
        readonly entityid: number;
    }

    /** What the `survival_teammate_respawn` event carries. */
    interface SurvivalTeammateRespawnEvent {
        /** EventSurvivalTeammateRespawn.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `switch_team` event carries. */
    interface SwitchTeamEvent {
        /** EventSwitchTeam.AvgRank */
        readonly avgRank: number;
        /** EventSwitchTeam.Numctslotsfree */
        readonly numctslotsfree: number;
        /** EventSwitchTeam.Numplayers */
        readonly numplayers: number;
        /** EventSwitchTeam.Numspectators */
        readonly numspectators: number;
        /** EventSwitchTeam.Numtslotsfree */
        readonly numtslotsfree: number;
    }

    /** What the `tagrenade_detonate` event carries. */
    interface TagrenadeDetonateEvent {
        /** EventTagrenadeDetonate.Entityid */
        readonly entityid: number;
        /** EventTagrenadeDetonate.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventTagrenadeDetonate.X */
        readonly x: number;
        /** EventTagrenadeDetonate.Y */
        readonly y: number;
        /** EventTagrenadeDetonate.Z */
        readonly z: number;
    }

    /** What the `team_info` event carries. */
    interface TeamInfoEvent {
        /** EventTeamInfo.Teamid */
        readonly teamid: number;
        /** EventTeamInfo.Teamname */
        readonly teamname: string;
    }

    /** What the `team_intro_end` event carries. */
    interface TeamIntroEndEvent {
    }

    /** What the `team_intro_start` event carries. */
    interface TeamIntroStartEvent {
    }

    /** What the `team_score` event carries. */
    interface TeamScoreEvent {
        /** EventTeamScore.Score */
        readonly score: number;
        /** EventTeamScore.Teamid */
        readonly teamid: number;
    }

    /** What the `teamchange_pending` event carries. */
    interface TeamchangePendingEvent {
        /** EventTeamchangePending.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventTeamchangePending.Toteam */
        readonly toteam: number;
    }

    /** What the `teamplay_broadcast_audio` event carries. */
    interface TeamplayBroadcastAudioEvent {
        /** EventTeamplayBroadcastAudio.Sound */
        readonly sound: string;
        /** EventTeamplayBroadcastAudio.Team */
        readonly team: number;
    }

    /** What the `teamplay_round_start` event carries. */
    interface TeamplayRoundStartEvent {
        /** EventTeamplayRoundStart.FullReset */
        readonly fullReset: boolean;
    }

    /** What the `tournament_reward` event carries. */
    interface TournamentRewardEvent {
        /** EventTournamentReward.Accountid */
        readonly accountid: number;
        /** EventTournamentReward.Defindex */
        readonly defindex: number;
        /** EventTournamentReward.Totalrewards */
        readonly totalrewards: number;
    }

    /** What the `trial_time_expired` event carries. */
    interface TrialTimeExpiredEvent {
        /** EventTrialTimeExpired.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `ugc_file_download_finished` event carries. */
    interface UgcFileDownloadFinishedEvent {
        /** EventUgcFileDownloadFinished.Hcontent — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly hcontent: string;
    }

    /** What the `ugc_file_download_start` event carries. */
    interface UgcFileDownloadStartEvent {
        /** EventUgcFileDownloadStart.Hcontent — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly hcontent: string;
        /** EventUgcFileDownloadStart.PublishedFileId — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly publishedFileId: string;
    }

    /** What the `ugc_map_download_error` event carries. */
    interface UgcMapDownloadErrorEvent {
        /** EventUgcMapDownloadError.ErrorCode */
        readonly errorCode: number;
        /** EventUgcMapDownloadError.PublishedFileId — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly publishedFileId: string;
    }

    /** What the `ugc_map_info_received` event carries. */
    interface UgcMapInfoReceivedEvent {
        /** EventUgcMapInfoReceived.PublishedFileId — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly publishedFileId: string;
    }

    /** What the `ugc_map_unsubscribed` event carries. */
    interface UgcMapUnsubscribedEvent {
        /** EventUgcMapUnsubscribed.PublishedFileId — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly publishedFileId: string;
    }

    /** What the `update_matchmaking_stats` event carries. */
    interface UpdateMatchmakingStatsEvent {
    }

    /** What the `user_data_downloaded` event carries. */
    interface UserDataDownloadedEvent {
    }

    /** What the `vip_escaped` event carries. */
    interface VipEscapedEvent {
        /** EventVipEscaped.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `vip_killed` event carries. */
    interface VipKilledEvent {
        /** EventVipKilled.Attacker */
        readonly attacker: Player | null;
        /** EventVipKilled.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `vote_cast` event carries. */
    interface VoteCastEvent {
        /** EventVoteCast.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventVoteCast.Team */
        readonly team: number;
        /** EventVoteCast.VoteOption */
        readonly voteOption: number;
    }

    /** What the `vote_cast_no` event carries. */
    interface VoteCastNoEvent {
        /** EventVoteCastNo.Entityid */
        readonly entityid: number;
        /** EventVoteCastNo.Team */
        readonly team: number;
    }

    /** What the `vote_cast_yes` event carries. */
    interface VoteCastYesEvent {
        /** EventVoteCastYes.Entityid */
        readonly entityid: number;
        /** EventVoteCastYes.Team */
        readonly team: number;
    }

    /** What the `vote_changed` event carries. */
    interface VoteChangedEvent {
        /** EventVoteChanged.Novotes */
        readonly novotes: number;
        /** EventVoteChanged.Potentialvotes */
        readonly potentialvotes: number;
        /** EventVoteChanged.VoteOption1 */
        readonly voteOption1: number;
        /** EventVoteChanged.VoteOption2 */
        readonly voteOption2: number;
        /** EventVoteChanged.VoteOption3 */
        readonly voteOption3: number;
        /** EventVoteChanged.VoteOption4 */
        readonly voteOption4: number;
        /** EventVoteChanged.VoteOption5 */
        readonly voteOption5: number;
        /** EventVoteChanged.Yesvotes */
        readonly yesvotes: number;
    }

    /** What the `vote_ended` event carries. */
    interface VoteEndedEvent {
    }

    /** What the `vote_failed` event carries. */
    interface VoteFailedEvent {
        /** EventVoteFailed.Reliable */
        readonly reliable: number;
        /** EventVoteFailed.Team */
        readonly team: number;
    }

    /** What the `vote_options` event carries. */
    interface VoteOptionsEvent {
        /** EventVoteOptions.Count */
        readonly count: number;
        /** EventVoteOptions.Option1 */
        readonly option1: string;
        /** EventVoteOptions.Option2 */
        readonly option2: string;
        /** EventVoteOptions.Option3 */
        readonly option3: string;
        /** EventVoteOptions.Option4 */
        readonly option4: string;
        /** EventVoteOptions.Option5 */
        readonly option5: string;
    }

    /** What the `vote_passed` event carries. */
    interface VotePassedEvent {
        /** EventVotePassed.Details */
        readonly details: string;
        /** EventVotePassed.Param1 */
        readonly param1: string;
        /** EventVotePassed.Reliable */
        readonly reliable: number;
        /** EventVotePassed.Team */
        readonly team: number;
    }

    /** What the `vote_started` event carries. */
    interface VoteStartedEvent {
        /** EventVoteStarted.Initiator */
        readonly initiator: number;
        /** EventVoteStarted.Issue */
        readonly issue: string;
        /** EventVoteStarted.Param1 */
        readonly param1: string;
        /** EventVoteStarted.Reliable */
        readonly reliable: number;
        /** EventVoteStarted.Team */
        readonly team: number;
        /** EventVoteStarted.Votedata */
        readonly votedata: string;
    }

    /** What the `warmup_end` event carries. */
    interface WarmupEndEvent {
    }

    /** What the `weapon_fire` event carries. */
    interface WeaponFireEvent {
        /** EventWeaponFire.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventWeaponFire.Silenced */
        readonly silenced: boolean;
        /** EventWeaponFire.Weapon */
        readonly weapon: string;
    }

    /** What the `weapon_fire_on_empty` event carries. */
    interface WeaponFireOnEmptyEvent {
        /** EventWeaponFireOnEmpty.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
        /** EventWeaponFireOnEmpty.Weapon */
        readonly weapon: string;
    }

    /** What the `weapon_reload` event carries. */
    interface WeaponReloadEvent {
        /** EventWeaponReload.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `weapon_zoom` event carries. */
    interface WeaponZoomEvent {
        /** EventWeaponZoom.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `weapon_zoom_rifle` event carries. */
    interface WeaponZoomRifleEvent {
        /** EventWeaponZoomRifle.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `weaponhud_selection` event carries. */
    interface WeaponhudSelectionEvent {
        /** EventWeaponhudSelection.Entindex */
        readonly entindex: number;
        /** EventWeaponhudSelection.Mode */
        readonly mode: number;
        /** EventWeaponhudSelection.Userid — Renamed: the event calls this userid, and it is a player. */
        readonly player: Player | null;
    }

    /** What the `write_game_titledata` event carries. */
    interface WriteGameTitledataEvent {
        /** EventWriteGameTitledata.Controllerid */
        readonly controllerid: number;
    }

    /** What the `write_profile_data` event carries. */
    interface WriteProfileDataEvent {
    }

    interface Cs2TsEvents {
        achievement_earned: (event: AchievementEarnedEvent) => void;
        achievement_earned_local: (event: AchievementEarnedLocalEvent) => void;
        achievement_event: (event: AchievementEventEvent) => void;
        achievement_info_loaded: (event: AchievementInfoLoadedEvent) => void;
        achievement_write_failed: (event: AchievementWriteFailedEvent) => void;
        add_bullet_hit_marker: (event: AddBulletHitMarkerEvent) => void;
        add_player_sonar_icon: (event: AddPlayerSonarIconEvent) => void;
        ammo_pickup: (event: AmmoPickupEvent) => void;
        ammo_refill: (event: AmmoRefillEvent) => void;
        announce_phase_end: (event: AnnouncePhaseEndEvent) => void;
        begin_new_match: (event: BeginNewMatchEvent) => void;
        bomb_abortdefuse: (event: BombAbortdefuseEvent) => void;
        bomb_abortplant: (event: BombAbortplantEvent) => void;
        bomb_beep: (event: BombBeepEvent) => void;
        bomb_begindefuse: (event: BombBegindefuseEvent) => void;
        bomb_beginplant: (event: BombBeginplantEvent) => void;
        bomb_defused: (event: BombDefusedEvent) => void;
        bomb_dropped: (event: BombDroppedEvent) => void;
        bomb_exploded: (event: BombExplodedEvent) => void;
        bomb_pickup: (event: BombPickupEvent) => void;
        bomb_planted: (event: BombPlantedEvent) => void;
        bonus_updated: (event: BonusUpdatedEvent) => void;
        bot_takeover: (event: BotTakeoverEvent) => void;
        break_breakable: (event: BreakBreakableEvent) => void;
        break_prop: (event: BreakPropEvent) => void;
        broken_breakable: (event: BrokenBreakableEvent) => void;
        bullet_damage: (event: BulletDamageEvent) => void;
        bullet_impact: (event: BulletImpactEvent) => void;
        buymenu_close: (event: BuymenuCloseEvent) => void;
        buymenu_open: (event: BuymenuOpenEvent) => void;
        buytime_ended: (event: BuytimeEndedEvent) => void;
        cart_updated: (event: CartUpdatedEvent) => void;
        choppers_incoming_warning: (event: ChoppersIncomingWarningEvent) => void;
        client_disconnect: (event: ClientDisconnectEvent) => void;
        client_loadout_changed: (event: ClientLoadoutChangedEvent) => void;
        clientside_lesson_closed: (event: ClientsideLessonClosedEvent) => void;
        clientside_reload_custom_econ: (event: ClientsideReloadCustomEconEvent) => void;
        cs_game_disconnected: (event: CsGameDisconnectedEvent) => void;
        cs_intermission: (event: CsIntermissionEvent) => void;
        cs_match_end_restart: (event: CsMatchEndRestartEvent) => void;
        cs_pre_restart: (event: CsPreRestartEvent) => void;
        cs_prev_next_spectator: (event: CsPrevNextSpectatorEvent) => void;
        cs_round_final_beep: (event: CsRoundFinalBeepEvent) => void;
        cs_round_start_beep: (event: CsRoundStartBeepEvent) => void;
        cs_win_panel_match: (event: CsWinPanelMatchEvent) => void;
        cs_win_panel_round: (event: CsWinPanelRoundEvent) => void;
        decoy_detonate: (event: DecoyDetonateEvent) => void;
        decoy_firing: (event: DecoyFiringEvent) => void;
        decoy_started: (event: DecoyStartedEvent) => void;
        defuser_dropped: (event: DefuserDroppedEvent) => void;
        defuser_pickup: (event: DefuserPickupEvent) => void;
        demo_skip: (event: DemoSkipEvent) => void;
        demo_start: (event: DemoStartEvent) => void;
        demo_stop: (event: DemoStopEvent) => void;
        difficulty_changed: (event: DifficultyChangedEvent) => void;
        dm_bonus_weapon_start: (event: DmBonusWeaponStartEvent) => void;
        door_break: (event: DoorBreakEvent) => void;
        door_close: (event: DoorCloseEvent) => void;
        door_closed: (event: DoorClosedEvent) => void;
        door_moving: (event: DoorMovingEvent) => void;
        door_open: (event: DoorOpenEvent) => void;
        drone_above_roof: (event: DroneAboveRoofEvent) => void;
        drone_cargo_detached: (event: DroneCargoDetachedEvent) => void;
        drone_dispatched: (event: DroneDispatchedEvent) => void;
        dronegun_attack: (event: DronegunAttackEvent) => void;
        drop_rate_modified: (event: DropRateModifiedEvent) => void;
        dynamic_shadow_light_changed: (event: DynamicShadowLightChangedEvent) => void;
        dz_item_interaction: (event: DzItemInteractionEvent) => void;
        enable_restart_voting: (event: EnableRestartVotingEvent) => void;
        endmatch_cmm_start_reveal_items: (event: EndmatchCmmStartRevealItemsEvent) => void;
        endmatch_mapvote_selecting_map: (event: EndmatchMapvoteSelectingMapEvent) => void;
        enter_bombzone: (event: EnterBombzoneEvent) => void;
        enter_buyzone: (event: EnterBuyzoneEvent) => void;
        enter_rescue_zone: (event: EnterRescueZoneEvent) => void;
        entity_killed: (event: EntityKilledEvent) => void;
        entity_visible: (event: EntityVisibleEvent) => void;
        event_ticket_modified: (event: EventTicketModifiedEvent) => void;
        exit_bombzone: (event: ExitBombzoneEvent) => void;
        exit_buyzone: (event: ExitBuyzoneEvent) => void;
        exit_rescue_zone: (event: ExitRescueZoneEvent) => void;
        finale_start: (event: FinaleStartEvent) => void;
        firstbombs_incoming_warning: (event: FirstbombsIncomingWarningEvent) => void;
        flare_ignite_npc: (event: FlareIgniteNpcEvent) => void;
        flashbang_detonate: (event: FlashbangDetonateEvent) => void;
        game_end: (event: GameEndEvent) => void;
        game_init: (event: GameInitEvent) => void;
        game_message: (event: GameMessageEvent) => void;
        game_newmap: (event: GameNewmapEvent) => void;
        game_phase_changed: (event: GamePhaseChangedEvent) => void;
        game_start: (event: GameStartEvent) => void;
        gameinstructor_draw: (event: GameinstructorDrawEvent) => void;
        gameinstructor_nodraw: (event: GameinstructorNodrawEvent) => void;
        gameui_hidden: (event: GameuiHiddenEvent) => void;
        gc_connected: (event: GcConnectedEvent) => void;
        gg_killed_enemy: (event: GgKilledEnemyEvent) => void;
        grenade_bounce: (event: GrenadeBounceEvent) => void;
        grenade_thrown: (event: GrenadeThrownEvent) => void;
        guardian_wave_restart: (event: GuardianWaveRestartEvent) => void;
        hegrenade_detonate: (event: HegrenadeDetonateEvent) => void;
        helicopter_grenade_punt_miss: (event: HelicopterGrenadePuntMissEvent) => void;
        hide_deathpanel: (event: HideDeathpanelEvent) => void;
        hltv_cameraman: (event: HltvCameramanEvent) => void;
        hltv_changed_mode: (event: HltvChangedModeEvent) => void;
        hltv_chase: (event: HltvChaseEvent) => void;
        hltv_chat: (event: HltvChatEvent) => void;
        hltv_fixed: (event: HltvFixedEvent) => void;
        hltv_message: (event: HltvMessageEvent) => void;
        hltv_rank_camera: (event: HltvRankCameraEvent) => void;
        hltv_rank_entity: (event: HltvRankEntityEvent) => void;
        hltv_replay: (event: HltvReplayEvent) => void;
        hltv_replay_status: (event: HltvReplayStatusEvent) => void;
        hltv_status: (event: HltvStatusEvent) => void;
        hltv_title: (event: HltvTitleEvent) => void;
        hltv_versioninfo: (event: HltvVersioninfoEvent) => void;
        hostage_call_for_help: (event: HostageCallForHelpEvent) => void;
        hostage_follows: (event: HostageFollowsEvent) => void;
        hostage_hurt: (event: HostageHurtEvent) => void;
        hostage_killed: (event: HostageKilledEvent) => void;
        hostage_rescued: (event: HostageRescuedEvent) => void;
        hostage_rescued_all: (event: HostageRescuedAllEvent) => void;
        hostage_stops_following: (event: HostageStopsFollowingEvent) => void;
        hostname_changed: (event: HostnameChangedEvent) => void;
        inferno_expire: (event: InfernoExpireEvent) => void;
        inferno_extinguish: (event: InfernoExtinguishEvent) => void;
        inferno_startburn: (event: InfernoStartburnEvent) => void;
        inspect_weapon: (event: InspectWeaponEvent) => void;
        instructor_close_lesson: (event: InstructorCloseLessonEvent) => void;
        instructor_server_hint_create: (event: InstructorServerHintCreateEvent) => void;
        instructor_server_hint_stop: (event: InstructorServerHintStopEvent) => void;
        instructor_start_lesson: (event: InstructorStartLessonEvent) => void;
        inventory_updated: (event: InventoryUpdatedEvent) => void;
        item_equip: (event: ItemEquipEvent) => void;
        item_pickup: (event: ItemPickupEvent) => void;
        item_pickup_failed: (event: ItemPickupFailedEvent) => void;
        item_pickup_slerp: (event: ItemPickupSlerpEvent) => void;
        item_purchase: (event: ItemPurchaseEvent) => void;
        item_remove: (event: ItemRemoveEvent) => void;
        item_schema_initialized: (event: ItemSchemaInitializedEvent) => void;
        jointeam_failed: (event: JointeamFailedEvent) => void;
        local_player_controller_team: (event: LocalPlayerControllerTeamEvent) => void;
        local_player_pawn_changed: (event: LocalPlayerPawnChangedEvent) => void;
        local_player_team: (event: LocalPlayerTeamEvent) => void;
        loot_crate_opened: (event: LootCrateOpenedEvent) => void;
        loot_crate_visible: (event: LootCrateVisibleEvent) => void;
        map_shutdown: (event: MapShutdownEvent) => void;
        map_transition: (event: MapTransitionEvent) => void;
        match_end_conditions: (event: MatchEndConditionsEvent) => void;
        material_default_complete: (event: MaterialDefaultCompleteEvent) => void;
        mb_input_lock_cancel: (event: MbInputLockCancelEvent) => void;
        mb_input_lock_success: (event: MbInputLockSuccessEvent) => void;
        molotov_detonate: (event: MolotovDetonateEvent) => void;
        nav_blocked: (event: NavBlockedEvent) => void;
        nav_generate: (event: NavGenerateEvent) => void;
        nextlevel_changed: (event: NextlevelChangedEvent) => void;
        open_crate_instr: (event: OpenCrateInstrEvent) => void;
        other_death: (event: OtherDeathEvent) => void;
        parachute_deploy: (event: ParachuteDeployEvent) => void;
        parachute_pickup: (event: ParachutePickupEvent) => void;
        physgun_pickup: (event: PhysgunPickupEvent) => void;
        player_activate: (event: PlayerActivateEvent) => void;
        player_avenged_teammate: (event: PlayerAvengedTeammateEvent) => void;
        player_blind: (event: PlayerBlindEvent) => void;
        player_changename: (event: PlayerChangenameEvent) => void;
        player_chat: (event: PlayerChatEvent) => void;
        player_connect: (event: PlayerConnectEvent) => void;
        player_connect_full: (event: PlayerConnectFullEvent) => void;
        player_death: (event: PlayerDeathEvent) => void;
        player_decal: (event: PlayerDecalEvent) => void;
        player_disconnect: (event: PlayerDisconnectEvent) => void;
        player_falldamage: (event: PlayerFalldamageEvent) => void;
        player_footstep: (event: PlayerFootstepEvent) => void;
        player_full_update: (event: PlayerFullUpdateEvent) => void;
        player_given_c4: (event: PlayerGivenC4Event) => void;
        player_hintmessage: (event: PlayerHintmessageEvent) => void;
        player_hurt: (event: PlayerHurtEvent) => void;
        player_info: (event: PlayerInfoEvent) => void;
        player_jump: (event: PlayerJumpEvent) => void;
        player_ping: (event: PlayerPingEvent) => void;
        player_ping_stop: (event: PlayerPingStopEvent) => void;
        player_radio: (event: PlayerRadioEvent) => void;
        player_reset_vote: (event: PlayerResetVoteEvent) => void;
        player_score: (event: PlayerScoreEvent) => void;
        player_shoot: (event: PlayerShootEvent) => void;
        player_sound: (event: PlayerSoundEvent) => void;
        player_spawn: (event: PlayerSpawnEvent) => void;
        player_spawned: (event: PlayerSpawnedEvent) => void;
        player_stats_updated: (event: PlayerStatsUpdatedEvent) => void;
        player_team: (event: PlayerTeamEvent) => void;
        ragdoll_dissolved: (event: RagdollDissolvedEvent) => void;
        read_game_titledata: (event: ReadGameTitledataEvent) => void;
        repost_xbox_achievements: (event: RepostXboxAchievementsEvent) => void;
        reset_game_titledata: (event: ResetGameTitledataEvent) => void;
        round_announce_final: (event: RoundAnnounceFinalEvent) => void;
        round_announce_last_round_half: (event: RoundAnnounceLastRoundHalfEvent) => void;
        round_announce_match_point: (event: RoundAnnounceMatchPointEvent) => void;
        round_announce_match_start: (event: RoundAnnounceMatchStartEvent) => void;
        round_announce_warmup: (event: RoundAnnounceWarmupEvent) => void;
        round_end: (event: RoundEndEvent) => void;
        round_end_upload_stats: (event: RoundEndUploadStatsEvent) => void;
        round_freeze_end: (event: RoundFreezeEndEvent) => void;
        round_mvp: (event: RoundMvpEvent) => void;
        round_officially_ended: (event: RoundOfficiallyEndedEvent) => void;
        round_poststart: (event: RoundPoststartEvent) => void;
        round_prestart: (event: RoundPrestartEvent) => void;
        round_start: (event: RoundStartEvent) => void;
        round_start_post_nav: (event: RoundStartPostNavEvent) => void;
        round_start_pre_entity: (event: RoundStartPreEntityEvent) => void;
        round_time_warning: (event: RoundTimeWarningEvent) => void;
        seasoncoin_levelup: (event: SeasoncoinLevelupEvent) => void;
        server_cvar: (event: ServerCvarEvent) => void;
        server_message: (event: ServerMessageEvent) => void;
        server_pre_shutdown: (event: ServerPreShutdownEvent) => void;
        server_shutdown: (event: ServerShutdownEvent) => void;
        server_spawn: (event: ServerSpawnEvent) => void;
        set_instructor_group_enabled: (event: SetInstructorGroupEnabledEvent) => void;
        sfuievent: (event: SfuieventEvent) => void;
        show_deathpanel: (event: ShowDeathpanelEvent) => void;
        show_survival_respawn_status: (event: ShowSurvivalRespawnStatusEvent) => void;
        silencer_detach: (event: SilencerDetachEvent) => void;
        silencer_off: (event: SilencerOffEvent) => void;
        silencer_on: (event: SilencerOnEvent) => void;
        smoke_beacon_paradrop: (event: SmokeBeaconParadropEvent) => void;
        smokegrenade_detonate: (event: SmokegrenadeDetonateEvent) => void;
        smokegrenade_expired: (event: SmokegrenadeExpiredEvent) => void;
        spec_mode_updated: (event: SpecModeUpdatedEvent) => void;
        spec_target_updated: (event: SpecTargetUpdatedEvent) => void;
        start_halftime: (event: StartHalftimeEvent) => void;
        start_vote: (event: StartVoteEvent) => void;
        store_pricesheet_updated: (event: StorePricesheetUpdatedEvent) => void;
        survival_announce_phase: (event: SurvivalAnnouncePhaseEvent) => void;
        survival_no_respawns_final: (event: SurvivalNoRespawnsFinalEvent) => void;
        survival_no_respawns_warning: (event: SurvivalNoRespawnsWarningEvent) => void;
        survival_paradrop_break: (event: SurvivalParadropBreakEvent) => void;
        survival_paradrop_spawn: (event: SurvivalParadropSpawnEvent) => void;
        survival_teammate_respawn: (event: SurvivalTeammateRespawnEvent) => void;
        switch_team: (event: SwitchTeamEvent) => void;
        tagrenade_detonate: (event: TagrenadeDetonateEvent) => void;
        team_info: (event: TeamInfoEvent) => void;
        team_intro_end: (event: TeamIntroEndEvent) => void;
        team_intro_start: (event: TeamIntroStartEvent) => void;
        team_score: (event: TeamScoreEvent) => void;
        teamchange_pending: (event: TeamchangePendingEvent) => void;
        teamplay_broadcast_audio: (event: TeamplayBroadcastAudioEvent) => void;
        teamplay_round_start: (event: TeamplayRoundStartEvent) => void;
        tournament_reward: (event: TournamentRewardEvent) => void;
        trial_time_expired: (event: TrialTimeExpiredEvent) => void;
        ugc_file_download_finished: (event: UgcFileDownloadFinishedEvent) => void;
        ugc_file_download_start: (event: UgcFileDownloadStartEvent) => void;
        ugc_map_download_error: (event: UgcMapDownloadErrorEvent) => void;
        ugc_map_info_received: (event: UgcMapInfoReceivedEvent) => void;
        ugc_map_unsubscribed: (event: UgcMapUnsubscribedEvent) => void;
        update_matchmaking_stats: (event: UpdateMatchmakingStatsEvent) => void;
        user_data_downloaded: (event: UserDataDownloadedEvent) => void;
        vip_escaped: (event: VipEscapedEvent) => void;
        vip_killed: (event: VipKilledEvent) => void;
        vote_cast: (event: VoteCastEvent) => void;
        vote_cast_no: (event: VoteCastNoEvent) => void;
        vote_cast_yes: (event: VoteCastYesEvent) => void;
        vote_changed: (event: VoteChangedEvent) => void;
        vote_ended: (event: VoteEndedEvent) => void;
        vote_failed: (event: VoteFailedEvent) => void;
        vote_options: (event: VoteOptionsEvent) => void;
        vote_passed: (event: VotePassedEvent) => void;
        vote_started: (event: VoteStartedEvent) => void;
        warmup_end: (event: WarmupEndEvent) => void;
        weapon_fire: (event: WeaponFireEvent) => void;
        weapon_fire_on_empty: (event: WeaponFireOnEmptyEvent) => void;
        weapon_reload: (event: WeaponReloadEvent) => void;
        weapon_zoom: (event: WeaponZoomEvent) => void;
        weapon_zoom_rifle: (event: WeaponZoomRifleEvent) => void;
        weaponhud_selection: (event: WeaponhudSelectionEvent) => void;
        write_game_titledata: (event: WriteGameTitledataEvent) => void;
        write_profile_data: (event: WriteProfileDataEvent) => void;
    }
    // END GENERATED

    /**
     * A player. Holds a userid, not a pointer, so it stays usable after the player
     * leaves — every member simply starts throwing something catchable instead.
     *
     * Two guards never throw, and one of them is the right one to reach for:
     *
     * - `isValid` — are they still on the server?
     * - `isAlive` — are they in the world? False for spectators and for the dead.
     *
     * `isAlive` is the guard to write, and not because the alternative throws. A dead
     * player still has a pawn — a corpse — so `health`, `armor` and `position` read
     * from it and return 0, 0 and where they fell. They throw only when there is no
     * pawn at all: a spectator, or someone who has not spawned yet. Measured on a
     * server, because the opposite was written here first.
     *
     * So `try`/`catch` is not a substitute for `isAlive`: healing a player without
     * checking will quietly set a corpse to 100 rather than raise anything.
     *
     * Writing `health`, `armor` or `money` also tells the clients about it. Doing the
     * same thing through CounterStrikeSharp is two calls, and forgetting the second
     * one changes the value on the server while every player keeps seeing the old one.
     */
    interface Player extends EntityHandle {
        /**
         * Whether the player is alive and in the world. Never throws.
         *
         * Worth checking inside `player_spawn` too: the first spawn after a map change
         * arrives before the pawn does, so `health` and `position` throw there while
         * every later spawn reads fine.
         */
        readonly isAlive: boolean;

        /** The name the player is showing right now. */
        readonly name: string;

        /**
         * The player's Steam ID, as a string — a 64-bit id does not survive a
         * JavaScript number, and the one it rounds to belongs to somebody else.
         */
        readonly steamId: string;

        /** Whether this is a bot rather than a person. */
        readonly isBot: boolean;

        /** 1 spectator, 2 T, 3 CT. */
        readonly team: number;

        /** The player's money. Writing it replicates. */
        money: number;

        /** Health. Writing it replicates. Throws unless the player is in the world. */
        health: number;

        /** Armour. Writing it replicates. Throws unless the player is in the world. */
        armor: number;

        /**
         * Where the player is, copied out at the moment of the read: changing x, y or z
         * on what comes back moves nothing. Throws unless the player is in the world.
         */
        readonly position: { readonly x: number; readonly y: number; readonly z: number };

        /** Writes one line into this player's chat, and nobody else's. */
        sendChat(message: string): void;

        /**
         * Moves the player, keeping their view angles and velocity. Throws unless the
         * player is in the world.
         */
        teleport(x: number, y: number, z: number): void;

        /**
         * The player's body, with every field it has — or `null` when they have none.
         *
         * The `null` is the point. A spectator, someone who has not spawned, someone
         * between maps: none of them have a body, and this is the one place where that
         * is a question the compiler makes you answer rather than something `health`
         * throws at you later.
         *
         * It answers about this moment, though. A pawn that was there a tick ago can be
         * gone now, so the fields on what comes back still throw — non-null is an
         * observation, not a promise. Throws itself if the player has left.
         */
        readonly pawn: Entity<PawnRaw> | null;

        /**
         * The persistent half of the player, with every field it has. Never null: a
         * controller is there for as long as the player is, so a check here could never
         * fail and would say nothing about the case that can. Throws if the player has
         * left.
         */
        readonly controller: Entity<ControllerRaw>;
    }

    /**
     * The one event the runtime raises itself. Everything else `on` accepts is a game
     * event, generated above from CounterStrikeSharp's own event classes and merged
     * into this interface — so `on` knows all of them by name and gives each handler
     * the right argument.
     *
     * Each game event hands the handler one object, and that object is a snapshot taken
     * while the event was still live. Keeping it is safe: numbers and strings were
     * copied out, and every player on it is a `Player`, which is an identity rather
     * than a pointer.
     */
    interface Cs2TsEvents {
        /**
         * Every game tick — 64 times a second on a standard server.
         *
         * The only event that is not something happening; it is the game loop itself,
         * and it is the way to do anything the other events cannot express: watching a
         * value change, driving movement, reacting faster than a round or a spawn.
         *
         * It carries no argument. What tick it is and how long the server has been up
         * are both on `server`, and passing a number here that nobody uses would cost
         * a conversion sixty-four times a second.
         *
         * What a handler does here it does sixty-four times a second, so this is the
         * one place where an ordinary amount of work is too much: a loop over every
         * player, a string built per player, an allocation kept. There is no budget
         * enforced beyond the one that stops a handler running for half a second, so a
         * handler that is merely slow will not be reported — it will show up as a
         * server that feels worse.
         *
         * A handler that throws repeatedly is taken out of service like any other, and
         * here that matters more than usual: without it the failure would be reported
         * sixty-four times a second, forever.
         */
        tick: () => void;
    }

    /**
     * Registers a handler. A handler that throws is reported against this script's file
     * and line and does not reach the server; one that keeps throwing is taken out of
     * service.
     */
    function on<E extends keyof Cs2TsEvents>(event: E, handler: Cs2TsEvents[E]): void;

    /**
     * Registers a chat and console command.
     *
     * ```ts
     * command("!heal", (player, args) => {
     *     if (player === null) {
     *         console.log("heal needs a player");
     *         return;
     *     }
     *     player.health = 100;
     * });
     * ```
     *
     * The name is what a player types. A leading `!`, `/` or `.` is stripped — which
     * trigger character a server uses is a server setting, so hard-coding one would
     * break elsewhere — and what is left has to be letters, digits and underscores.
     * The same command also answers from the server console, as `css_<name>`.
     *
     * `player` is `null` when it came from the console or RCON rather than from
     * someone in the game, and the type says so because forgetting that case is how a
     * command works in chat and throws for the operator.
     *
     * `args` is everything after the command itself, unparsed.
     *
     * A bad name throws while the script is loading, so the script does not load. That
     * is deliberate: the alternative is a command that exists and never fires.
     */
    function command(
        name: string,
        handler: (player: Player | null, args: string[]) => void,
    ): void;

    /**
     * Runs `handler` once, after at least `delay` milliseconds. Returns an id for
     * `clearTimeout`.
     *
     * "At least" is the honest word: timers are checked once per game tick, so on a
     * 64 tick server nothing fires more finely than roughly every 15ms, and a delay of
     * 0 means the next tick rather than right now. Asking for less does no harm, it
     * just does not buy anything.
     *
     * The handler runs on the game thread, so it may touch the game directly — unlike a
     * callback coming back from asynchronous work, which has to go through
     * `server.nextFrame`.
     *
     * Anything the handler captures is kept alive until it fires, and a player captured
     * five seconds ago may well have left; `Player` holds an identity rather than a
     * pointer, so check `isValid` rather than assuming.
     *
     * Timers belong to the script that set them. Reloading or unloading it cancels
     * every one of them, which is why a reload does not leave the previous version's
     * work running underneath the new one.
     */
    function setTimeout(handler: () => void, delay?: number): number;

    /**
     * Runs `handler` every `delay` milliseconds until `clearInterval` is called.
     * Returns an id.
     *
     * The rate does not drift. Each run is scheduled from when the previous one was
     * due, not from when it actually ran, so the tick it waited is not added to the next
     * period. Carrying it forward would cost about a tick every time — on a one second
     * interval, fifty seconds an hour.
     *
     * There is no catch-up either. If the server hitches for two seconds, a 100ms
     * interval fires once and starts a fresh schedule — not twenty times in one tick to
     * make up the difference, which is never what was wanted and lands exactly when the
     * server can least afford it.
     *
     * A handler that keeps throwing is taken out of service like any other, and its
     * interval stops with it rather than failing forever on a schedule.
     */
    function setInterval(handler: () => void, delay?: number): number;

    /** Cancels a timer. Cancelling one that already fired, or never existed, is fine. */
    function clearTimeout(id: number): boolean;

    /** Cancels a timer. The same function as `clearTimeout`; both ids come from one counter. */
    function clearInterval(id: number): boolean;

    const server: {
        /**
         * Runs a callback on the game thread. The way back from asynchronous work —
         * and the only direction that exists.
         */
        nextFrame(callback: () => void): void;

        /** Runs a server console command. */
        command(command: string): void;

        /**
         * The map currently running. Never null in a script: nothing a script writes
         * runs before the map is up, because reading the game any earlier crashes the
         * server outright.
         */
        readonly mapName: string;

        readonly currentTime: number;
    };

    /** Bare V8 has no console; this one is a host API and writes to the server log. */
    const console: {
        log(value?: unknown): void;
        warn(value?: unknown): void;
        error(value?: unknown): void;
    };

    const players: {
        /** The player for a userid, whether or not they are connected now. */
        byUserId(userId: number): Player;

        /** Everyone currently connected. */
        all(): Player[];
    };

    /**
     * Everything in the world that is not a player: weapons, the bomb, hostages, doors,
     * props, and whatever a script makes itself.
     *
     * ```ts
     * const bomb = entities.first("planted_c4");
     * if (bomb !== null) console.log(`${bomb.position?.x}`);
     *
     * const box = entities.create("prop_physics_override");
     * box.raw.teamNum = 2;
     * box.spawn();
     * box.teleport(0, 0, 128);
     * ```
     *
     * What comes back is the same kind of object a player's pawn is, so `raw` and
     * `unsafe` work on it the same way. Its `raw` is the fields **every** entity has,
     * not the ones a weapon or a door has of its own; `unsafe` is still how to reach
     * those, by name.
     *
     * These references hold the game's own entity handle, which is a slot number with a
     * serial number packed above it — so a reference kept after the entity is gone
     * reads as invalid rather than quietly becoming a reference to whatever took the
     * slot. That matters more here than it does for players: entity slots are recycled
     * constantly, several times a round.
     */
    const entities: {
        /** The entity in a slot, or `null` when the slot is empty. */
        byIndex(index: number): Entity<EntityRaw> | null;

        /**
         * Every entity whose classname is exactly this. Empty when there are none.
         *
         * Exact, not a substring match: `find("weapon_knife")` returns the plain knives
         * and not every knife skin, which is the opposite of what CounterStrikeSharp's
         * own search by designer name does.
         */
        find(designerName: string): Entity<EntityRaw>[];

        /** The first entity with this classname, or `null`. */
        first(designerName: string): Entity<EntityRaw> | null;

        /**
         * Everything in the world right now.
         *
         * A long list — a stock map is a couple of thousand entities before anyone
         * joins — and every one of them becomes an object that is then held for as long
         * as it lives. It is here because there is otherwise no way to find out what
         * classnames a map has, which is the first thing anyone needs. It is not
         * something to call on a tick.
         */
        all(): Entity<EntityRaw>[];

        /**
         * Makes an entity, not yet in the world: write to it, then `spawn()` it, then
         * put it somewhere with `teleport()`.
         *
         * Throws if the game will not make one of those. The alternative is a typo that
         * hands back an object which silently does nothing.
         */
        create(designerName: string): Entity<EntityRaw>;
    };

    /**
     * Entity fields the facade does not cover, read and written by name.
     *
     * ```ts
     * const pawn = unsafe.pawn(player);
     * unsafe.setInt(pawn, "CBaseEntity", "m_iHealth", 55);
     * ```
     *
     * The facade is the way to do the ordinary things, and it will always be behind the
     * game. This is the way through for the rest — the fields nobody has written a
     * facade member for. `resolve()` cannot do it: schema fields are the one kind of
     * member that does not survive the trip into script, which is why the names are
     * passed as strings and the reading and writing happen on the host side.
     *
     * It is called `unsafe` because it is, in a specific way. The names are not checked
     * by the compiler and they are not obvious:
     *
     * - The class is the one that **declares** the field, not the one that inherits it.
     *   Health is `CBaseEntity.m_iHealth` even when the entity is a `CCSPlayerPawn`.
     *   Armour is `CCSPlayerPawn.m_ArmorValue`. Getting this wrong is the normal way to
     *   get it wrong.
     * - A name the schema does not know throws, with the pair that failed in the
     *   message. That check is the reason this is usable at all: underneath,
     *   CounterStrikeSharp resolves an unknown name to offset zero and writes there,
     *   over the entity's vtable pointer, without reporting anything.
     * - The type has to match the field. Reading an int field with `getFloat` returns
     *   the same bytes read as a float, which is a number, and a wrong one. Nothing
     *   here can catch that.
     *
     * Writes replicate: the state change the engine needs is sent for you, for the
     * fields that are networked.
     *
     * Both accessors take an entity from `pawn()` or `controller()`. Do not keep one
     * past the statement that made it — the pawn a script stored is freed at the end of
     * the round, and the `Player` it came from is the thing designed to be kept.
     *
     * Anything from `entities` gets here through its own `resolve()`, and that is how
     * to read a field this `raw` does not have — a weapon's ammunition, the bomb's
     * timer, a door's speed:
     *
     * ```ts
     * const bomb = entities.first("planted_c4");
     * if (bomb !== null) {
     *     const blow: number = unsafe.getFloat(bomb.resolve(), "CPlantedC4", "m_flC4Blow");
     * }
     * ```
     */
    const unsafe: {
        /**
         * The player's controller: the half of them that persists, where name, team and
         * money live. The same object `player.resolve()` returns. Throws if the player
         * has left.
         */
        controller(player: Player): unknown;

        /**
         * The player's pawn: their body, where health, armour and position live. Throws
         * if the player has left, and if they are not in the world — check `isAlive`.
         */
        pawn(player: Player): unknown;

        getInt(entity: unknown, className: string, field: string): number;
        setInt(entity: unknown, className: string, field: string, value: number): void;

        getFloat(entity: unknown, className: string, field: string): number;
        setFloat(entity: unknown, className: string, field: string, value: number): void;

        getBool(entity: unknown, className: string, field: string): boolean;
        setBool(entity: unknown, className: string, field: string, value: boolean): void;

        /**
         * Reads a string field, as the characters stored in the field itself.
         *
         * There is no `setString`, on purpose. CounterStrikeSharp's two halves disagree
         * about what a string field is — the getter reads characters from the field's
         * own address, the setter writes an eight-byte pointer there — so for every
         * field where reading works, writing would overwrite the first eight characters
         * and report nothing.
         */
        getString(entity: unknown, className: string, field: string): string;
    };
}

export {};

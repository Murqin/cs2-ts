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
     * A field that holds another entity is the one exception, and it arrives as an
     * `Entity` rather than as a number. What the game stores there is a handle — a slot
     * with a serial number above it — which is exactly the identity these objects are
     * keyed by, so `pawn.raw.groundEntity` is the thing being stood on and not an index
     * to go and look up. It is `null` when the field points at nothing, and it is
     * read-only: what writing one means varies per field, several are the engine's own
     * bookkeeping, and getting one wrong is not a value that looks odd — it is an entity
     * pointing at the wrong owner.
     *
     * Worth knowing about `controller.raw.playerPawn`: it is the pawn as an entity, and
     * `player.pawn` is whatever body that player has right now. They point at the same
     * thing while the player is alive and they are not the same object, because they
     * answer different questions — one follows the player across a respawn, the other
     * dies with the body.
     *
     * What is still missing is whole objects — sub-entities, vectors and angles, and
     * arrays. Those wait for a step that can give them a shape worth having. `unsafe`
     * still reaches a field by name in the meantime.
     *
     * Writing any of these replicates, the same as the curated members do.
     */
    // BEGIN GENERATED — tools/datagen writes everything to the next marker; do not edit.
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
        /** CBaseEntity/m_pBlocker — Another entity, or null when it points at nothing. Read-only. */
        readonly blocker: Entity<EntityRaw> | null;
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
        /** CBaseEntity/m_hDamageFilter — Another entity, or null when it points at nothing. Read-only. */
        readonly damageFilter: Entity<EntityRaw> | null;
        /** CBaseEntity/m_iszDamageFilterName — Read-only, as every string field is. */
        readonly damageFilterName: string;
        /** CBaseEntity/m_bDisableLowViolence */
        disableLowViolence: boolean;
        /** CBaseEntity/m_bDisabledContextThinks */
        disabledContextThinks: boolean;
        /** CBaseEntity/m_iEFlags */
        eFlags: number;
        /** CBaseEntity/m_hEffectEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly effectEntity: Entity<EntityRaw> | null;
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
        /** CBaseEntity/m_hGroundEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly groundEntity: Entity<EntityRaw> | null;
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
        /** CBaseEntity/m_hOwnerEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly ownerEntity: Entity<EntityRaw> | null;
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

    /** The fields a CAI_ChangeHintGroup adds to EntityRaw. */
    interface CAI_ChangeHintGroupRaw extends EntityRaw {
        /** CAI_ChangeHintGroup/m_flRadius */
        radius: number;
        /** CAI_ChangeHintGroup/m_iSearchType */
        searchType: number;
        /** CAI_ChangeHintGroup/m_strNewHintGroup — Read-only, as every string field is. */
        readonly strNewHintGroup: string;
        /** CAI_ChangeHintGroup/m_strSearchName — Read-only, as every string field is. */
        readonly strSearchName: string;
    }

    /** The fields a CBaseModelEntity adds to EntityRaw. */
    interface CBaseModelEntityRaw extends EntityRaw {
        /** CBaseModelEntity/m_bAllowFadeInView */
        allowFadeInView: boolean;
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
        /** CBaseModelEntity/m_flDissolveStartTime */
        dissolveStartTime: number;
        /** CBaseModelEntity/m_fadeMaxDist */
        fadeMaxDist: number;
        /** CBaseModelEntity/m_fadeMinDist */
        fadeMinDist: number;
        /** CBaseModelEntity/m_flFadeScale */
        fadeScale: number;
        /** CBaseModelEntity/m_flGlowBackfaceMult */
        glowBackfaceMult: number;
        /** CBaseModelEntity/m_bNoInterpolate */
        noInterpolate: boolean;
        /** CBaseModelEntity/m_nObjectCulling */
        objectCulling: number;
        /** CBaseModelEntity/m_nRenderFX — A RenderFx_t. */
        renderFX: number;
        /** CBaseModelEntity/m_nRenderMode — A RenderMode_t. */
        renderMode: number;
        /** CBaseModelEntity/m_bRenderToCubemaps */
        renderToCubemaps: boolean;
        /** CBaseModelEntity/m_flShadowStrength */
        shadowStrength: number;
    }

    /** The fields a CBasePlayerController adds to EntityRaw. */
    interface CBasePlayerControllerRaw extends EntityRaw {
        /** CBasePlayerController/m_nAvailableEntitySteadyState */
        availableEntitySteadyState: number;
        /** CBasePlayerController/m_iConnected — A PlayerConnectedState. */
        connected: number;
        /** CBasePlayerController/m_iDesiredFOV */
        desiredFOV: number;
        /** CBasePlayerController/m_bGamePaused */
        gamePaused: boolean;
        /** CBasePlayerController/m_bHasAnySteadyStateEnts */
        hasAnySteadyStateEnts: boolean;
        /** CBasePlayerController/m_iIgnoreGlobalChat — A ChatIgnoreType_t. */
        ignoreGlobalChat: number;
        /** CBasePlayerController/m_nInButtonsWhichAreToggles — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly inButtonsWhichAreToggles: string;
        /** CBasePlayerController/m_bIsHLTV */
        isHLTV: boolean;
        /** CBasePlayerController/m_bIsLowViolence */
        isLowViolence: boolean;
        /** CBasePlayerController/m_bKnownTeamMismatch */
        knownTeamMismatch: boolean;
        /** CBasePlayerController/m_bLagCompensation */
        lagCompensation: boolean;
        /** CBasePlayerController/m_flLastEntitySteadyState */
        lastEntitySteadyState: number;
        /** CBasePlayerController/m_flLastPlayerTalkTime */
        lastPlayerTalkTime: number;
        /** CBasePlayerController/m_fLerpTime */
        lerpTime: number;
        /** CBasePlayerController/m_iMostConnected — A PlayerConnectedState. */
        mostConnected: number;
        /** CBasePlayerController/m_szNetworkIDString — Read-only, as every string field is. */
        readonly networkIDString: string;
        /** CBasePlayerController/m_bNoClipEnabled */
        noClipEnabled: boolean;
        /** CBasePlayerController/m_hPawn — Another entity, or null when it points at nothing. Read-only. */
        readonly pawn: Entity<EntityRaw> | null;
        /** CBasePlayerController/m_iszPlayerName — Read-only, as every string field is. */
        readonly playerName: string;
        /** CBasePlayerController/m_bPredict */
        predict: boolean;
        /** CBasePlayerController/m_hSplitOwner — Another entity, or null when it points at nothing. Read-only. */
        readonly splitOwner: Entity<EntityRaw> | null;
        /** CBasePlayerController/m_nSplitScreenSlot */
        splitScreenSlot: number;
        /** CBasePlayerController/m_steamID — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly steamID: string;
        /** CBasePlayerController/m_nTickBase */
        tickBase: number;
    }

    /** The fields a CCSGO_EndOfMatchLineupEndpoint adds to EntityRaw. */
    interface CCSGO_EndOfMatchLineupEndpointRaw extends EntityRaw {
    }

    /** The fields a CCSGO_TeamPreviewCharacterPosition adds to EntityRaw. */
    interface CCSGO_TeamPreviewCharacterPositionRaw extends EntityRaw {
        /** CCSGO_TeamPreviewCharacterPosition/m_nOrdinal */
        ordinal: number;
        /** CCSGO_TeamPreviewCharacterPosition/m_nRandom */
        random: number;
        /** CCSGO_TeamPreviewCharacterPosition/m_nVariant */
        variant: number;
        /** CCSGO_TeamPreviewCharacterPosition/m_sWeaponName — Read-only, as every string field is. */
        readonly weaponName: string;
        /** CCSGO_TeamPreviewCharacterPosition/m_xuid — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly xuid: string;
    }

    /** The fields a CCSMinimapBoundary adds to EntityRaw. */
    interface CCSMinimapBoundaryRaw extends EntityRaw {
    }

    /** The fields a CCSPetPlacement adds to EntityRaw. */
    interface CCSPetPlacementRaw extends EntityRaw {
    }

    /** The fields a CCSPlayerResource adds to EntityRaw. */
    interface CCSPlayerResourceRaw extends EntityRaw {
        /** CCSPlayerResource/m_bEndMatchNextMapAllVoted */
        endMatchNextMapAllVoted: boolean;
        /** CCSPlayerResource/m_foundGoalPositions */
        foundGoalPositions: boolean;
    }

    /** The fields a CCSPointScriptEntity adds to EntityRaw. */
    interface CCSPointScriptEntityRaw extends EntityRaw {
    }

    /** The fields a CCitadelSoundOpvarSetOBB adds to EntityRaw. */
    interface CCitadelSoundOpvarSetOBBRaw extends EntityRaw {
        /** CCitadelSoundOpvarSetOBB/m_nAABBDirection */
        aABBDirection: number;
        /** CCitadelSoundOpvarSetOBB/m_iszOperatorName — Read-only, as every string field is. */
        readonly operatorName: string;
        /** CCitadelSoundOpvarSetOBB/m_iszOpvarName — Read-only, as every string field is. */
        readonly opvarName: string;
        /** CCitadelSoundOpvarSetOBB/m_iszStackName — Read-only, as every string field is. */
        readonly stackName: string;
    }

    /** The fields a CColorCorrection adds to EntityRaw. */
    interface CColorCorrectionRaw extends EntityRaw {
        /** CColorCorrection/m_bClientSide */
        clientSide: boolean;
        /** CColorCorrection/m_flCurWeight */
        curWeight: number;
        /** CColorCorrection/m_bEnabled */
        enabled: boolean;
        /** CColorCorrection/m_bExclusive */
        exclusive: boolean;
        /** CColorCorrection/m_flFadeInDuration */
        fadeInDuration: number;
        /** CColorCorrection/m_flFadeOutDuration */
        fadeOutDuration: number;
        /** CColorCorrection/m_lookupFilename — Read-only, as every string field is. */
        readonly lookupFilename: string;
        /** CColorCorrection/m_bMaster */
        master: boolean;
        /** CColorCorrection/m_MaxFalloff */
        maxFalloff: number;
        /** CColorCorrection/m_flMaxWeight */
        maxWeight: number;
        /** CColorCorrection/m_MinFalloff */
        minFalloff: number;
        /** CColorCorrection/m_netlookupFilename — Read-only, as every string field is. */
        readonly netlookupFilename: string;
        /** CColorCorrection/m_bStartDisabled */
        startDisabled: boolean;
        /** CColorCorrection/m_flStartFadeInWeight */
        startFadeInWeight: number;
        /** CColorCorrection/m_flStartFadeOutWeight */
        startFadeOutWeight: number;
        /** CColorCorrection/m_flTimeStartFadeIn */
        timeStartFadeIn: number;
        /** CColorCorrection/m_flTimeStartFadeOut */
        timeStartFadeOut: number;
    }

    /** The fields a CCommentaryAuto adds to EntityRaw. */
    interface CCommentaryAutoRaw extends EntityRaw {
    }

    /** The fields a CDebugHistory adds to EntityRaw. */
    interface CDebugHistoryRaw extends EntityRaw {
        /** CDebugHistory/m_nNpcEvents */
        npcEvents: number;
    }

    /** The fields a CEnableMotionFixup adds to EntityRaw. */
    interface CEnableMotionFixupRaw extends EntityRaw {
    }

    /** The fields a CEntityFlame adds to EntityRaw. */
    interface CEntityFlameRaw extends EntityRaw {
        /** CEntityFlame/m_hAttacker — Another entity, or null when it points at nothing. Read-only. */
        readonly attacker: Entity<EntityRaw> | null;
        /** CEntityFlame/m_bCheapEffect */
        cheapEffect: boolean;
        /** CEntityFlame/m_iCustomDamageType */
        customDamageType: number;
        /** CEntityFlame/m_flDirectDamagePerSecond */
        directDamagePerSecond: number;
        /** CEntityFlame/m_hEntAttached — Another entity, or null when it points at nothing. Read-only. */
        readonly entAttached: Entity<EntityRaw> | null;
        /** CEntityFlame/m_flHitboxFireScale */
        hitboxFireScale: number;
        /** CEntityFlame/m_flLifetime */
        lifetime: number;
        /** CEntityFlame/m_iNumHitboxFires */
        numHitboxFires: number;
        /** CEntityFlame/m_flSize */
        size: number;
        /** CEntityFlame/m_bUseHitboxes */
        useHitboxes: boolean;
    }

    /** The fields a CEnvBeverage adds to EntityRaw. */
    interface CEnvBeverageRaw extends EntityRaw {
        /** CEnvBeverage/m_nBeverageType */
        beverageType: number;
        /** CEnvBeverage/m_CanInDispenser */
        canInDispenser: boolean;
    }

    /** The fields a CEnvCombinedLightProbeVolume adds to EntityRaw. */
    interface CEnvCombinedLightProbeVolumeRaw extends EntityRaw {
        /** CEnvCombinedLightProbeVolume/m_Entity_bCustomCubemapTexture */
        entity_bCustomCubemapTexture: boolean;
        /** CEnvCombinedLightProbeVolume/m_Entity_bEnabled */
        entity_bEnabled: boolean;
        /** CEnvCombinedLightProbeVolume/m_Entity_bMoveable */
        entity_bMoveable: boolean;
        /** CEnvCombinedLightProbeVolume/m_Entity_bStartDisabled */
        entity_bStartDisabled: boolean;
        /** CEnvCombinedLightProbeVolume/m_Entity_flBrightness */
        entity_flBrightness: number;
        /** CEnvCombinedLightProbeVolume/m_Entity_flEdgeFadeDist */
        entity_flEdgeFadeDist: number;
        /** CEnvCombinedLightProbeVolume/m_Entity_nEnvCubeMapArrayIndex */
        entity_nEnvCubeMapArrayIndex: number;
        /** CEnvCombinedLightProbeVolume/m_Entity_nHandshake */
        entity_nHandshake: number;
        /** CEnvCombinedLightProbeVolume/m_Entity_nLightProbeAtlasX */
        entity_nLightProbeAtlasX: number;
        /** CEnvCombinedLightProbeVolume/m_Entity_nLightProbeAtlasY */
        entity_nLightProbeAtlasY: number;
        /** CEnvCombinedLightProbeVolume/m_Entity_nLightProbeAtlasZ */
        entity_nLightProbeAtlasZ: number;
        /** CEnvCombinedLightProbeVolume/m_Entity_nLightProbeSizeX */
        entity_nLightProbeSizeX: number;
        /** CEnvCombinedLightProbeVolume/m_Entity_nLightProbeSizeY */
        entity_nLightProbeSizeY: number;
        /** CEnvCombinedLightProbeVolume/m_Entity_nLightProbeSizeZ */
        entity_nLightProbeSizeZ: number;
        /** CEnvCombinedLightProbeVolume/m_Entity_nPriority */
        entity_nPriority: number;
    }

    /** The fields a CEnvCubemap adds to EntityRaw. */
    interface CEnvCubemapRaw extends EntityRaw {
        /** CEnvCubemap/m_Entity_bCopyDiffuseFromDefaultCubemap */
        entity_bCopyDiffuseFromDefaultCubemap: boolean;
        /** CEnvCubemap/m_Entity_bCustomCubemapTexture */
        entity_bCustomCubemapTexture: boolean;
        /** CEnvCubemap/m_Entity_bDefaultEnvMap */
        entity_bDefaultEnvMap: boolean;
        /** CEnvCubemap/m_Entity_bDefaultSpecEnvMap */
        entity_bDefaultSpecEnvMap: boolean;
        /** CEnvCubemap/m_Entity_bEnabled */
        entity_bEnabled: boolean;
        /** CEnvCubemap/m_Entity_bIndoorCubeMap */
        entity_bIndoorCubeMap: boolean;
        /** CEnvCubemap/m_Entity_bMoveable */
        entity_bMoveable: boolean;
        /** CEnvCubemap/m_Entity_bStartDisabled */
        entity_bStartDisabled: boolean;
        /** CEnvCubemap/m_Entity_flDiffuseScale */
        entity_flDiffuseScale: number;
        /** CEnvCubemap/m_Entity_flEdgeFadeDist */
        entity_flEdgeFadeDist: number;
        /** CEnvCubemap/m_Entity_flInfluenceRadius */
        entity_flInfluenceRadius: number;
        /** CEnvCubemap/m_Entity_nEnvCubeMapArrayIndex */
        entity_nEnvCubeMapArrayIndex: number;
        /** CEnvCubemap/m_Entity_nHandshake */
        entity_nHandshake: number;
        /** CEnvCubemap/m_Entity_nPriority */
        entity_nPriority: number;
    }

    /** The fields a CEnvCubemapFog adds to EntityRaw. */
    interface CEnvCubemapFogRaw extends EntityRaw {
        /** CEnvCubemapFog/m_bActive */
        active: boolean;
        /** CEnvCubemapFog/m_nCubemapSourceType */
        cubemapSourceType: number;
        /** CEnvCubemapFog/m_DistanceFogCurveString — Read-only, as every string field is. */
        readonly distanceFogCurveString: string;
        /** CEnvCubemapFog/m_nDistanceFogType */
        distanceFogType: number;
        /** CEnvCubemapFog/m_flEndDistance */
        endDistance: number;
        /** CEnvCubemapFog/m_bFirstTime */
        firstTime: boolean;
        /** CEnvCubemapFog/m_flFogFalloffExponent */
        fogFalloffExponent: number;
        /** CEnvCubemapFog/m_nFogHeightBlendMode */
        fogHeightBlendMode: number;
        /** CEnvCubemapFog/m_nFogHeightCoordinateSpace */
        fogHeightCoordinateSpace: number;
        /** CEnvCubemapFog/m_flFogHeightEnd */
        fogHeightEnd: number;
        /** CEnvCubemapFog/m_flFogHeightExponent */
        fogHeightExponent: number;
        /** CEnvCubemapFog/m_flFogHeightStart */
        fogHeightStart: number;
        /** CEnvCubemapFog/m_flFogHeightWidth */
        fogHeightWidth: number;
        /** CEnvCubemapFog/m_flFogMaxOpacity */
        fogMaxOpacity: number;
        /** CEnvCubemapFog/m_bHasHeightFogEnd */
        hasHeightFogEnd: boolean;
        /** CEnvCubemapFog/m_HeightFogCurveString — Read-only, as every string field is. */
        readonly heightFogCurveString: string;
        /** CEnvCubemapFog/m_bHeightFogEnabled */
        heightFogEnabled: boolean;
        /** CEnvCubemapFog/m_nHeightFogType */
        heightFogType: number;
        /** CEnvCubemapFog/m_flLODBias */
        lODBias: number;
        /** CEnvCubemapFog/m_iszSkyEntity — Read-only, as every string field is. */
        readonly skyEntity: string;
        /** CEnvCubemapFog/m_bStartDisabled */
        startDisabled: boolean;
        /** CEnvCubemapFog/m_flStartDistance */
        startDistance: number;
    }

    /** The fields a CEnvDetailController adds to EntityRaw. */
    interface CEnvDetailControllerRaw extends EntityRaw {
        /** CEnvDetailController/m_flFadeEndDist */
        fadeEndDist: number;
        /** CEnvDetailController/m_flFadeStartDist */
        fadeStartDist: number;
    }

    /** The fields a CEnvEntityIgniter adds to EntityRaw. */
    interface CEnvEntityIgniterRaw extends EntityRaw {
        /** CEnvEntityIgniter/m_flLifetime */
        lifetime: number;
    }

    /** The fields a CEnvLightProbeVolume adds to EntityRaw. */
    interface CEnvLightProbeVolumeRaw extends EntityRaw {
        /** CEnvLightProbeVolume/m_Entity_bEnabled */
        entity_bEnabled: boolean;
        /** CEnvLightProbeVolume/m_Entity_bMoveable */
        entity_bMoveable: boolean;
        /** CEnvLightProbeVolume/m_Entity_bStartDisabled */
        entity_bStartDisabled: boolean;
        /** CEnvLightProbeVolume/m_Entity_nHandshake */
        entity_nHandshake: number;
        /** CEnvLightProbeVolume/m_Entity_nLightProbeAtlasX */
        entity_nLightProbeAtlasX: number;
        /** CEnvLightProbeVolume/m_Entity_nLightProbeAtlasY */
        entity_nLightProbeAtlasY: number;
        /** CEnvLightProbeVolume/m_Entity_nLightProbeAtlasZ */
        entity_nLightProbeAtlasZ: number;
        /** CEnvLightProbeVolume/m_Entity_nLightProbeSizeX */
        entity_nLightProbeSizeX: number;
        /** CEnvLightProbeVolume/m_Entity_nLightProbeSizeY */
        entity_nLightProbeSizeY: number;
        /** CEnvLightProbeVolume/m_Entity_nLightProbeSizeZ */
        entity_nLightProbeSizeZ: number;
        /** CEnvLightProbeVolume/m_Entity_nPriority */
        entity_nPriority: number;
    }

    /** The fields a CEnvSoundscape adds to EntityRaw. */
    interface CEnvSoundscapeRaw extends EntityRaw {
        /** CEnvSoundscape/m_bDisabled */
        disabled: boolean;
        /** CEnvSoundscape/m_bOverrideWithEvent */
        overrideWithEvent: boolean;
        /** CEnvSoundscape/m_hProxySoundscape — Another entity, or null when it points at nothing. Read-only. */
        readonly proxySoundscape: Entity<EntityRaw> | null;
        /** CEnvSoundscape/m_flRadius */
        radius: number;
        /** CEnvSoundscape/m_soundEventHash */
        soundEventHash: number;
        /** CEnvSoundscape/m_soundEventName — Read-only, as every string field is. */
        readonly soundEventName: string;
        /** CEnvSoundscape/m_soundscapeEntityListId */
        soundscapeEntityListId: number;
        /** CEnvSoundscape/m_soundscapeIndex */
        soundscapeIndex: number;
        /** CEnvSoundscape/m_soundscapeName — Read-only, as every string field is. */
        readonly soundscapeName: string;
    }

    /** The fields a CEnvVolumetricFogController adds to EntityRaw. */
    interface CEnvVolumetricFogControllerRaw extends EntityRaw {
        /** CEnvVolumetricFogController/m_bActive */
        active: boolean;
        /** CEnvVolumetricFogController/m_flAnisotropy */
        anisotropy: number;
        /** CEnvVolumetricFogController/m_flDefaultAnisotropy */
        defaultAnisotropy: number;
        /** CEnvVolumetricFogController/m_flDefaultDrawDistance */
        defaultDrawDistance: number;
        /** CEnvVolumetricFogController/m_flDefaultScattering */
        defaultScattering: number;
        /** CEnvVolumetricFogController/m_flDrawDistance */
        drawDistance: number;
        /** CEnvVolumetricFogController/m_bEnableIndirect */
        enableIndirect: boolean;
        /** CEnvVolumetricFogController/m_flFadeInEnd */
        fadeInEnd: number;
        /** CEnvVolumetricFogController/m_flFadeInStart */
        fadeInStart: number;
        /** CEnvVolumetricFogController/m_flFadeSpeed */
        fadeSpeed: number;
        /** CEnvVolumetricFogController/m_bFirstTime */
        firstTime: boolean;
        /** CEnvVolumetricFogController/m_fFirstVolumeSliceThickness */
        firstVolumeSliceThickness: number;
        /** CEnvVolumetricFogController/m_nForceRefreshCount */
        forceRefreshCount: number;
        /** CEnvVolumetricFogController/m_flIndirectStrength */
        indirectStrength: number;
        /** CEnvVolumetricFogController/m_nIndirectTextureDimX */
        indirectTextureDimX: number;
        /** CEnvVolumetricFogController/m_nIndirectTextureDimY */
        indirectTextureDimY: number;
        /** CEnvVolumetricFogController/m_nIndirectTextureDimZ */
        indirectTextureDimZ: number;
        /** CEnvVolumetricFogController/m_bIsMaster */
        isMaster: boolean;
        /** CEnvVolumetricFogController/m_fNoiseSpeed */
        noiseSpeed: number;
        /** CEnvVolumetricFogController/m_fNoiseStrength */
        noiseStrength: number;
        /** CEnvVolumetricFogController/m_flScattering */
        scattering: number;
        /** CEnvVolumetricFogController/m_flStartAnisoTime */
        startAnisoTime: number;
        /** CEnvVolumetricFogController/m_flStartAnisotropy */
        startAnisotropy: number;
        /** CEnvVolumetricFogController/m_bStartDisabled */
        startDisabled: boolean;
        /** CEnvVolumetricFogController/m_flStartDrawDistance */
        startDrawDistance: number;
        /** CEnvVolumetricFogController/m_flStartDrawDistanceTime */
        startDrawDistanceTime: number;
        /** CEnvVolumetricFogController/m_flStartScatterTime */
        startScatterTime: number;
        /** CEnvVolumetricFogController/m_flStartScattering */
        startScattering: number;
        /** CEnvVolumetricFogController/m_nVolumeDepth */
        volumeDepth: number;
        /** CEnvVolumetricFogController/m_fWindSpeed */
        windSpeed: number;
    }

    /** The fields a CEnvVolumetricFogVolume adds to EntityRaw. */
    interface CEnvVolumetricFogVolumeRaw extends EntityRaw {
        /** CEnvVolumetricFogVolume/m_bActive */
        active: boolean;
        /** CEnvVolumetricFogVolume/m_flFalloffExponent */
        falloffExponent: number;
        /** CEnvVolumetricFogVolume/m_nFalloffShape */
        falloffShape: number;
        /** CEnvVolumetricFogVolume/m_flHeightFogDepth */
        heightFogDepth: number;
        /** CEnvVolumetricFogVolume/m_fHeightFogEdgeWidth */
        heightFogEdgeWidth: number;
        /** CEnvVolumetricFogVolume/m_fIndirectLightStrength */
        indirectLightStrength: number;
        /** CEnvVolumetricFogVolume/m_bIndirectUseLPVs */
        indirectUseLPVs: boolean;
        /** CEnvVolumetricFogVolume/m_fNoiseStrength */
        noiseStrength: number;
        /** CEnvVolumetricFogVolume/m_bOverrideIndirectLightStrength */
        overrideIndirectLightStrength: boolean;
        /** CEnvVolumetricFogVolume/m_bOverrideNoiseStrength */
        overrideNoiseStrength: boolean;
        /** CEnvVolumetricFogVolume/m_bOverrideSunLightStrength */
        overrideSunLightStrength: boolean;
        /** CEnvVolumetricFogVolume/m_bOverrideTintColor */
        overrideTintColor: boolean;
        /** CEnvVolumetricFogVolume/m_bStartDisabled */
        startDisabled: boolean;
        /** CEnvVolumetricFogVolume/m_flStrength */
        strength: number;
        /** CEnvVolumetricFogVolume/m_fSunLightStrength */
        sunLightStrength: number;
    }

    /** The fields a CEnvWind adds to EntityRaw. */
    interface CEnvWindRaw extends EntityRaw {
    }

    /** The fields a CEnvWindController adds to EntityRaw. */
    interface CEnvWindControllerRaw extends EntityRaw {
        /** CEnvWindController/m_nClipmapLevels */
        clipmapLevels: number;
        /** CEnvWindController/m_fDirectionVariation */
        directionVariation: number;
        /** CEnvWindController/m_bFirstTime */
        firstTime: boolean;
        /** CEnvWindController/m_bIsMaster */
        isMaster: boolean;
        /** CEnvWindController/m_fSpeedVariation */
        speedVariation: number;
        /** CEnvWindController/m_fTurbulence */
        turbulence: number;
        /** CEnvWindController/m_fVolumeHalfExtentXY */
        volumeHalfExtentXY: number;
        /** CEnvWindController/m_fVolumeHalfExtentZ */
        volumeHalfExtentZ: number;
        /** CEnvWindController/m_nVolumeResolutionXY */
        volumeResolutionXY: number;
        /** CEnvWindController/m_nVolumeResolutionZ */
        volumeResolutionZ: number;
    }

    /** The fields a CEnvWindVolume adds to EntityRaw. */
    interface CEnvWindVolumeRaw extends EntityRaw {
        /** CEnvWindVolume/m_bActive */
        active: boolean;
        /** CEnvWindVolume/m_nShape */
        shape: number;
        /** CEnvWindVolume/m_bStartDisabled */
        startDisabled: boolean;
        /** CEnvWindVolume/m_fWindDirectionVariationMultiplier */
        windDirectionVariationMultiplier: number;
        /** CEnvWindVolume/m_fWindSpeedMultiplier */
        windSpeedMultiplier: number;
        /** CEnvWindVolume/m_fWindSpeedVariationMultiplier */
        windSpeedVariationMultiplier: number;
        /** CEnvWindVolume/m_fWindTurbulenceMultiplier */
        windTurbulenceMultiplier: number;
    }

    /** The fields a CFishPool adds to EntityRaw. */
    interface CFishPoolRaw extends EntityRaw {
        /** CFishPool/m_fishCount */
        fishCount: number;
        /** CFishPool/m_isDormant */
        isDormant: boolean;
        /** CFishPool/m_maxRange */
        maxRange: number;
        /** CFishPool/m_swimDepth */
        swimDepth: number;
        /** CFishPool/m_waterLevel */
        waterLevel: number;
    }

    /** The fields a CFogController adds to EntityRaw. */
    interface CFogControllerRaw extends EntityRaw {
        /** CFogController/m_iChangedVariables */
        changedVariables: number;
        /** CFogController/m_bUseAngles */
        useAngles: boolean;
    }

    /** The fields a CFuncPropRespawnZone adds to EntityRaw. */
    interface CFuncPropRespawnZoneRaw extends EntityRaw {
    }

    /** The fields a CFuncTimescale adds to EntityRaw. */
    interface CFuncTimescaleRaw extends EntityRaw {
        /** CFuncTimescale/m_flAcceleration */
        acceleration: number;
        /** CFuncTimescale/m_flBlendDeltaMultiplier */
        blendDeltaMultiplier: number;
        /** CFuncTimescale/m_flDesiredTimescale */
        desiredTimescale: number;
        /** CFuncTimescale/m_isStarted */
        isStarted: boolean;
        /** CFuncTimescale/m_flMinBlendRate */
        minBlendRate: number;
    }

    /** The fields a CGameGibManager adds to EntityRaw. */
    interface CGameGibManagerRaw extends EntityRaw {
        /** CGameGibManager/m_bAllowNewGibs */
        allowNewGibs: boolean;
        /** CGameGibManager/m_iCurrentMaxPieces */
        currentMaxPieces: number;
        /** CGameGibManager/m_iLastFrame */
        lastFrame: number;
        /** CGameGibManager/m_iMaxPieces */
        maxPieces: number;
    }

    /** The fields a CGameRulesProxy adds to EntityRaw. */
    interface CGameRulesProxyRaw extends EntityRaw {
    }

    /** The fields a CGradientFog adds to EntityRaw. */
    interface CGradientFogRaw extends EntityRaw {
        /** CGradientFog/m_flFadeTime */
        fadeTime: number;
        /** CGradientFog/m_flFarZ */
        farZ: number;
        /** CGradientFog/m_flFogEndDistance */
        fogEndDistance: number;
        /** CGradientFog/m_flFogEndHeight */
        fogEndHeight: number;
        /** CGradientFog/m_flFogFalloffExponent */
        fogFalloffExponent: number;
        /** CGradientFog/m_flFogMaxOpacity */
        fogMaxOpacity: number;
        /** CGradientFog/m_flFogStartDistance */
        fogStartDistance: number;
        /** CGradientFog/m_flFogStartHeight */
        fogStartHeight: number;
        /** CGradientFog/m_flFogStrength */
        fogStrength: number;
        /** CGradientFog/m_flFogVerticalExponent */
        fogVerticalExponent: number;
        /** CGradientFog/m_bGradientFogNeedsTextures */
        gradientFogNeedsTextures: boolean;
        /** CGradientFog/m_bHeightFogEnabled */
        heightFogEnabled: boolean;
        /** CGradientFog/m_bIsEnabled */
        isEnabled: boolean;
        /** CGradientFog/m_bStartDisabled */
        startDisabled: boolean;
    }

    /** The fields a CHandleDummy adds to EntityRaw. */
    interface CHandleDummyRaw extends EntityRaw {
    }

    /** The fields a CHandleTest adds to EntityRaw. */
    interface CHandleTestRaw extends EntityRaw {
        /** CHandleTest/m_bSendHandle */
        sendHandle: boolean;
        /** CHandleTest/m_Handle — Another entity, or null when it points at nothing. Read-only. */
        readonly testHandle: Entity<EntityRaw> | null;
    }

    /** The fields a CInfoLadderDismount adds to EntityRaw. */
    interface CInfoLadderDismountRaw extends EntityRaw {
    }

    /** The fields a CInfoVisibilityBox adds to EntityRaw. */
    interface CInfoVisibilityBoxRaw extends EntityRaw {
        /** CInfoVisibilityBox/m_bEnabled */
        enabled: boolean;
        /** CInfoVisibilityBox/m_nMode */
        mode: number;
    }

    /** The fields a CInfoWorldLayer adds to EntityRaw. */
    interface CInfoWorldLayerRaw extends EntityRaw {
        /** CInfoWorldLayer/m_bCreateAsChildSpawnGroup */
        createAsChildSpawnGroup: boolean;
        /** CInfoWorldLayer/m_bEntitiesSpawned */
        entitiesSpawned: boolean;
        /** CInfoWorldLayer/m_layerName — Read-only, as every string field is. */
        readonly layerName: string;
        /** CInfoWorldLayer/m_hLayerSpawnGroup */
        layerSpawnGroup: number;
        /** CInfoWorldLayer/m_bWorldLayerVisible */
        worldLayerVisible: boolean;
        /** CInfoWorldLayer/m_worldName — Read-only, as every string field is. */
        readonly worldName: string;
    }

    /** The fields a CLogicAuto adds to EntityRaw. */
    interface CLogicAutoRaw extends EntityRaw {
        /** CLogicAuto/m_globalstate — Read-only, as every string field is. */
        readonly globalstate: string;
    }

    /** The fields a CLogicGameStateReport adds to EntityRaw. */
    interface CLogicGameStateReportRaw extends EntityRaw {
        /** CLogicGameStateReport/m_bDisabled */
        disabled: boolean;
    }

    /** The fields a CLogicNPCCounter adds to EntityRaw. */
    interface CLogicNPCCounterRaw extends EntityRaw {
        /** CLogicNPCCounter/m_flDefaultDist_1 */
        defaultDist_1: number;
        /** CLogicNPCCounter/m_flDefaultDist_2 */
        defaultDist_2: number;
        /** CLogicNPCCounter/m_flDefaultDist_3 */
        defaultDist_3: number;
        /** CLogicNPCCounter/m_bDisabled */
        disabled: boolean;
        /** CLogicNPCCounter/m_flDistanceMax */
        distanceMax: number;
        /** CLogicNPCCounter/m_bInvertState_1 */
        invertState_1: boolean;
        /** CLogicNPCCounter/m_bInvertState_2 */
        invertState_2: boolean;
        /** CLogicNPCCounter/m_bInvertState_3 */
        invertState_3: boolean;
        /** CLogicNPCCounter/m_nMaxCountAll */
        maxCountAll: number;
        /** CLogicNPCCounter/m_nMaxCount_1 */
        maxCount_1: number;
        /** CLogicNPCCounter/m_nMaxCount_2 */
        maxCount_2: number;
        /** CLogicNPCCounter/m_nMaxCount_3 */
        maxCount_3: number;
        /** CLogicNPCCounter/m_nMaxFactorAll */
        maxFactorAll: number;
        /** CLogicNPCCounter/m_nMaxFactor_1 */
        maxFactor_1: number;
        /** CLogicNPCCounter/m_nMaxFactor_2 */
        maxFactor_2: number;
        /** CLogicNPCCounter/m_nMaxFactor_3 */
        maxFactor_3: number;
        /** CLogicNPCCounter/m_nMinCountAll */
        minCountAll: number;
        /** CLogicNPCCounter/m_nMinCount_1 */
        minCount_1: number;
        /** CLogicNPCCounter/m_nMinCount_2 */
        minCount_2: number;
        /** CLogicNPCCounter/m_nMinCount_3 */
        minCount_3: number;
        /** CLogicNPCCounter/m_nMinFactorAll */
        minFactorAll: number;
        /** CLogicNPCCounter/m_nMinFactor_1 */
        minFactor_1: number;
        /** CLogicNPCCounter/m_nMinFactor_2 */
        minFactor_2: number;
        /** CLogicNPCCounter/m_nMinFactor_3 */
        minFactor_3: number;
        /** CLogicNPCCounter/m_iszNPCClassname_1 — Read-only, as every string field is. */
        readonly nPCClassname_1: string;
        /** CLogicNPCCounter/m_iszNPCClassname_2 — Read-only, as every string field is. */
        readonly nPCClassname_2: string;
        /** CLogicNPCCounter/m_iszNPCClassname_3 — Read-only, as every string field is. */
        readonly nPCClassname_3: string;
        /** CLogicNPCCounter/m_nNPCState_1 */
        nPCState_1: number;
        /** CLogicNPCCounter/m_nNPCState_2 */
        nPCState_2: number;
        /** CLogicNPCCounter/m_nNPCState_3 */
        nPCState_3: number;
        /** CLogicNPCCounter/m_hSource — Another entity, or null when it points at nothing. Read-only. */
        readonly source: Entity<EntityRaw> | null;
        /** CLogicNPCCounter/m_iszSourceEntityName — Read-only, as every string field is. */
        readonly sourceEntityName: string;
    }

    /** The fields a CMapVetoPickController adds to EntityRaw. */
    interface CMapVetoPickControllerRaw extends EntityRaw {
        /** CMapVetoPickController/m_nCurrentPhase */
        currentPhase: number;
        /** CMapVetoPickController/m_dblPreMatchDraftSequenceTime */
        dblPreMatchDraftSequenceTime: number;
        /** CMapVetoPickController/m_nDraftType */
        draftType: number;
        /** CMapVetoPickController/m_bNeedToPlayFiveSecondsRemaining */
        needToPlayFiveSecondsRemaining: boolean;
        /** CMapVetoPickController/m_nPhaseDurationTicks */
        phaseDurationTicks: number;
        /** CMapVetoPickController/m_nPhaseStartTick */
        phaseStartTick: number;
        /** CMapVetoPickController/m_bPlayedIntroVcd */
        playedIntroVcd: boolean;
        /** CMapVetoPickController/m_bPreMatchDraftStateChanged */
        preMatchDraftStateChanged: boolean;
        /** CMapVetoPickController/m_nTeamWinningCoinToss */
        teamWinningCoinToss: number;
    }

    /** The fields a CNullEntity adds to EntityRaw. */
    interface CNullEntityRaw extends EntityRaw {
    }

    /** The fields a CPathParticleRope adds to EntityRaw. */
    interface CPathParticleRopeRaw extends EntityRaw {
        /** CPathParticleRope/m_iszEffectName — Read-only, as every string field is. */
        readonly effectName: string;
        /** CPathParticleRope/m_nEffectState */
        effectState: number;
        /** CPathParticleRope/m_flMaxSimulationTime */
        maxSimulationTime: number;
        /** CPathParticleRope/m_flParticleSpacing */
        particleSpacing: number;
        /** CPathParticleRope/m_flRadius */
        radius: number;
        /** CPathParticleRope/m_flSlack */
        slack: number;
        /** CPathParticleRope/m_bStartActive */
        startActive: boolean;
    }

    /** The fields a CPathSimple adds to EntityRaw. */
    interface CPathSimpleRaw extends EntityRaw {
        /** CPathSimple/m_bClosedLoop */
        closedLoop: boolean;
        /** CPathSimple/m_pathString — Read-only, as every string field is. */
        readonly pathString: string;
    }

    /** The fields a CPhysicsSpring adds to EntityRaw. */
    interface CPhysicsSpringRaw extends EntityRaw {
        /** CPhysicsSpring/m_flDampingRatio */
        dampingRatio: number;
        /** CPhysicsSpring/m_flFrequency */
        frequency: number;
        /** CPhysicsSpring/m_nameAttachEnd — Read-only, as every string field is. */
        readonly nameAttachEnd: string;
        /** CPhysicsSpring/m_nameAttachStart — Read-only, as every string field is. */
        readonly nameAttachStart: string;
        /** CPhysicsSpring/m_flRestLength */
        restLength: number;
        /** CPhysicsSpring/m_teleportTick */
        teleportTick: number;
    }

    /** The fields a CPhysicsWire adds to EntityRaw. */
    interface CPhysicsWireRaw extends EntityRaw {
        /** CPhysicsWire/m_nDensity */
        density: number;
    }

    /** The fields a CPlayerPing adds to EntityRaw. */
    interface CPlayerPingRaw extends EntityRaw {
        /** CPlayerPing/m_hPingedEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly pingedEntity: Entity<EntityRaw> | null;
        /** CPlayerPing/m_szPlaceName — Read-only, as every string field is. */
        readonly placeName: string;
        /** CPlayerPing/m_hPlayer — Another entity, or null when it points at nothing. Read-only. */
        readonly player: Entity<EntityRaw> | null;
        /** CPlayerPing/m_iType */
        type: number;
        /** CPlayerPing/m_bUrgent */
        urgent: boolean;
    }

    /** The fields a CPlayerVisibility adds to EntityRaw. */
    interface CPlayerVisibilityRaw extends EntityRaw {
        /** CPlayerVisibility/m_flFadeTime */
        fadeTime: number;
        /** CPlayerVisibility/m_flFogDistanceMultiplier */
        fogDistanceMultiplier: number;
        /** CPlayerVisibility/m_flFogMaxDensityMultiplier */
        fogMaxDensityMultiplier: number;
        /** CPlayerVisibility/m_bIsEnabled */
        isEnabled: boolean;
        /** CPlayerVisibility/m_bStartDisabled */
        startDisabled: boolean;
        /** CPlayerVisibility/m_flVisibilityStrength */
        visibilityStrength: number;
    }

    /** The fields a CPointCamera adds to EntityRaw. */
    interface CPointCameraRaw extends EntityRaw {
        /** CPointCamera/m_bActive */
        active: boolean;
        /** CPointCamera/m_bAlignWithParent */
        alignWithParent: boolean;
        /** CPointCamera/m_flAspectRatio */
        aspectRatio: number;
        /** CPointCamera/m_fBrightness */
        brightness: number;
        /** CPointCamera/m_bCanHLTVUse */
        canHLTVUse: boolean;
        /** CPointCamera/m_DegreesPerSecond */
        degreesPerSecond: number;
        /** CPointCamera/m_bDofEnabled */
        dofEnabled: boolean;
        /** CPointCamera/m_flDofFarBlurry */
        dofFarBlurry: number;
        /** CPointCamera/m_flDofFarCrisp */
        dofFarCrisp: number;
        /** CPointCamera/m_flDofNearBlurry */
        dofNearBlurry: number;
        /** CPointCamera/m_flDofNearCrisp */
        dofNearCrisp: number;
        /** CPointCamera/m_flDofTiltToGround */
        dofTiltToGround: number;
        /** CPointCamera/m_FOV */
        fOV: number;
        /** CPointCamera/m_bFogEnable */
        fogEnable: boolean;
        /** CPointCamera/m_flFogEnd */
        fogEnd: number;
        /** CPointCamera/m_flFogMaxDensity */
        fogMaxDensity: number;
        /** CPointCamera/m_flFogStart */
        fogStart: number;
        /** CPointCamera/m_bIsOn */
        isOn: boolean;
        /** CPointCamera/m_bNoSky */
        noSky: boolean;
        /** CPointCamera/m_Resolution */
        resolution: number;
        /** CPointCamera/m_TargetFOV */
        targetFOV: number;
        /** CPointCamera/m_bUseScreenAspectRatio */
        useScreenAspectRatio: boolean;
        /** CPointCamera/m_flZFar */
        zFar: number;
        /** CPointCamera/m_flZNear */
        zNear: number;
    }

    /** The fields a CPointEntity adds to EntityRaw. */
    interface CPointEntityRaw extends EntityRaw {
    }

    /** The fields a CPointEntityFinder adds to EntityRaw. */
    interface CPointEntityFinderRaw extends EntityRaw {
        /** CPointEntityFinder/m_hEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly entity: Entity<EntityRaw> | null;
        /** CPointEntityFinder/m_hFilter — Another entity, or null when it points at nothing. Read-only. */
        readonly filter: Entity<EntityRaw> | null;
        /** CPointEntityFinder/m_iFilterName — Read-only, as every string field is. */
        readonly filterName: string;
        /** CPointEntityFinder/m_FindMethod — A EntFinderMethod_t. */
        findMethod: number;
        /** CPointEntityFinder/m_iRefName — Read-only, as every string field is. */
        readonly refName: string;
        /** CPointEntityFinder/m_hReference — Another entity, or null when it points at nothing. Read-only. */
        readonly reference: Entity<EntityRaw> | null;
    }

    /** Every field a CPointOrient has, by name. Flattened: it reuses a base field's name for a different type. */
    interface CPointOrientRaw {
        /** CPointOrient/m_bActive */
        active: boolean;
        /** CBaseEntity/m_flActualGravityScale */
        actualGravityScale: number;
        /** CBaseEntity/m_nActualMoveType — A MoveType_t. */
        actualMoveType: number;
        /** CBaseEntity/m_flAnimTime */
        animTime: number;
        /** CBaseEntity/m_bAnimatedEveryTick */
        animatedEveryTick: boolean;
        /** CBaseEntity/m_pBlocker — Another entity, or null when it points at nothing. Read-only. */
        readonly blocker: Entity<EntityRaw> | null;
        /** CBaseEntity/m_nBloodType — A BloodType. */
        bloodType: number;
        /** CBaseEntity/m_bClientSideRagdoll */
        clientSideRagdoll: boolean;
        /** CPointOrient/m_nConstraint — A PointOrientConstraint_t. */
        constraint: number;
        /** CBaseEntity/m_flCreateTime */
        createTime: number;
        /** CBaseEntity/m_iCurrentThinkContext */
        currentThinkContext: number;
        /** CBaseEntity/m_flDamageAccumulator */
        damageAccumulator: number;
        /** CBaseEntity/m_hDamageFilter — Another entity, or null when it points at nothing. Read-only. */
        readonly damageFilter: Entity<EntityRaw> | null;
        /** CBaseEntity/m_iszDamageFilterName — Read-only, as every string field is. */
        readonly damageFilterName: string;
        /** CBaseEntity/m_bDisableLowViolence */
        disableLowViolence: boolean;
        /** CBaseEntity/m_bDisabledContextThinks */
        disabledContextThinks: boolean;
        /** CBaseEntity/m_iEFlags */
        eFlags: number;
        /** CBaseEntity/m_hEffectEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly effectEntity: Entity<EntityRaw> | null;
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
        /** CPointOrient/m_nGoalDirection — A PointOrientGoalDirectionType_t. */
        goalDirection: number;
        /** CBaseEntity/m_bGravityActuallyDisabled */
        gravityActuallyDisabled: boolean;
        /** CBaseEntity/m_bGravityDisabled */
        gravityDisabled: boolean;
        /** CBaseEntity/m_flGravityScale */
        gravityScale: number;
        /** CBaseEntity/m_nGroundBodyIndex */
        groundBodyIndex: number;
        /** CBaseEntity/m_hGroundEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly groundEntity: Entity<EntityRaw> | null;
        /** CBaseEntity/m_iHealth */
        health: number;
        /** CBaseEntity/m_iInitialTeamNum */
        initialTeamNum: number;
        /** CBaseEntity/m_ubInterpolationFrame */
        interpolationFrame: number;
        /** CBaseEntity/m_bLagCompensate */
        lagCompensate: boolean;
        /** CPointOrient/m_flLastGameTime */
        lastGameTime: number;
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
        /** CPointOrient/m_flMaxTurnRate */
        maxTurnRate: number;
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
        /** CBaseEntity/m_hOwnerEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly ownerEntity: Entity<EntityRaw> | null;
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
        /** CPointOrient/m_iszSpawnTargetName — Read-only, as every string field is. */
        readonly spawnTargetName: string;
        /** CBaseEntity/m_spawnflags */
        spawnflags: number;
        /** CBaseEntity/m_nTakeDamageFlags — A TakeDamageFlags_t. */
        takeDamageFlags: number;
        /** CBaseEntity/m_bTakesDamage */
        takesDamage: boolean;
        /** CPointOrient/m_hTarget — Another entity, or null when it points at nothing. Read-only. */
        readonly target: Entity<EntityRaw> | null;
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

    /** The fields a CPointPulse adds to EntityRaw. */
    interface CPointPulseRaw extends EntityRaw {
    }

    /** The fields a CPointValueRemapper adds to EntityRaw. */
    interface CPointValueRemapperRaw extends EntityRaw {
        /** CPointValueRemapper/m_flCurrentMomentum */
        currentMomentum: number;
        /** CPointValueRemapper/m_flCustomOutputValue */
        customOutputValue: number;
        /** CPointValueRemapper/m_bDisabled */
        disabled: boolean;
        /** CPointValueRemapper/m_flDisengageDistance */
        disengageDistance: number;
        /** CPointValueRemapper/m_flEngageDistance */
        engageDistance: number;
        /** CPointValueRemapper/m_bEngaged */
        engaged: boolean;
        /** CPointValueRemapper/m_bFirstUpdate */
        firstUpdate: boolean;
        /** CPointValueRemapper/m_nHapticsType — A ValueRemapperHapticsType_t. */
        hapticsType: number;
        /** CPointValueRemapper/m_flInputOffset */
        inputOffset: number;
        /** CPointValueRemapper/m_nInputType — A ValueRemapperInputType_t. */
        inputType: number;
        /** CPointValueRemapper/m_flMaximumChangePerSecond */
        maximumChangePerSecond: number;
        /** CPointValueRemapper/m_flMomentumModifier */
        momentumModifier: number;
        /** CPointValueRemapper/m_nMomentumType — A ValueRemapperMomentumType_t. */
        momentumType: number;
        /** CPointValueRemapper/m_iszOutputEntity2Name — Read-only, as every string field is. */
        readonly outputEntity2Name: string;
        /** CPointValueRemapper/m_iszOutputEntity3Name — Read-only, as every string field is. */
        readonly outputEntity3Name: string;
        /** CPointValueRemapper/m_iszOutputEntity4Name — Read-only, as every string field is. */
        readonly outputEntity4Name: string;
        /** CPointValueRemapper/m_iszOutputEntityName — Read-only, as every string field is. */
        readonly outputEntityName: string;
        /** CPointValueRemapper/m_nOutputType — A ValueRemapperOutputType_t. */
        outputType: number;
        /** CPointValueRemapper/m_flPreviousUpdateTickTime */
        previousUpdateTickTime: number;
        /** CPointValueRemapper/m_flPreviousValue */
        previousValue: number;
        /** CPointValueRemapper/m_flRatchetOffset */
        ratchetOffset: number;
        /** CPointValueRemapper/m_nRatchetType — A ValueRemapperRatchetType_t. */
        ratchetType: number;
        /** CPointValueRemapper/m_hRemapLineEnd — Another entity, or null when it points at nothing. Read-only. */
        readonly remapLineEnd: Entity<EntityRaw> | null;
        /** CPointValueRemapper/m_iszRemapLineEndName — Read-only, as every string field is. */
        readonly remapLineEndName: string;
        /** CPointValueRemapper/m_hRemapLineStart — Another entity, or null when it points at nothing. Read-only. */
        readonly remapLineStart: Entity<EntityRaw> | null;
        /** CPointValueRemapper/m_iszRemapLineStartName — Read-only, as every string field is. */
        readonly remapLineStartName: string;
        /** CPointValueRemapper/m_bRequiresUseKey */
        requiresUseKey: boolean;
        /** CPointValueRemapper/m_flSnapValue */
        snapValue: number;
        /** CPointValueRemapper/m_iszSoundDisengage — Read-only, as every string field is. */
        readonly soundDisengage: string;
        /** CPointValueRemapper/m_iszSoundEngage — Read-only, as every string field is. */
        readonly soundEngage: string;
        /** CPointValueRemapper/m_iszSoundMovingLoop — Read-only, as every string field is. */
        readonly soundMovingLoop: string;
        /** CPointValueRemapper/m_iszSoundReachedValueOne — Read-only, as every string field is. */
        readonly soundReachedValueOne: string;
        /** CPointValueRemapper/m_iszSoundReachedValueZero — Read-only, as every string field is. */
        readonly soundReachedValueZero: string;
        /** CPointValueRemapper/m_bUpdateOnClient */
        updateOnClient: boolean;
        /** CPointValueRemapper/m_hUsingPlayer — Another entity, or null when it points at nothing. Read-only. */
        readonly usingPlayer: Entity<EntityRaw> | null;
    }

    /** The fields a CPulseGameBlackboard adds to EntityRaw. */
    interface CPulseGameBlackboardRaw extends EntityRaw {
        /** CPulseGameBlackboard/m_strGraphName — Read-only, as every string field is. */
        readonly strGraphName: string;
        /** CPulseGameBlackboard/m_strStateBlob — Read-only, as every string field is. */
        readonly strStateBlob: string;
    }

    /** The fields a CRagdollManager adds to EntityRaw. */
    interface CRagdollManagerRaw extends EntityRaw {
        /** CRagdollManager/m_bCanTakeDamage */
        canTakeDamage: boolean;
        /** CRagdollManager/m_iCurrentMaxRagdollCount */
        currentMaxRagdollCount: number;
        /** CRagdollManager/m_iMaxRagdollCount */
        maxRagdollCount: number;
        /** CRagdollManager/m_bSaveImportant */
        saveImportant: boolean;
    }

    /** The fields a CScriptedSequence adds to EntityRaw. */
    interface CScriptedSequenceRaw extends EntityRaw {
        /** CScriptedSequence/m_bAllowCustomInterruptConditions */
        allowCustomInterruptConditions: boolean;
        /** CScriptedSequence/m_flAngRate */
        angRate: number;
        /** CScriptedSequence/m_bCanOverrideNPCState */
        canOverrideNPCState: boolean;
        /** CScriptedSequence/m_ConflictResponse — A ScriptedConflictResponse_t. */
        conflictResponse: number;
        /** CScriptedSequence/m_bContinueOnDeath */
        continueOnDeath: boolean;
        /** CScriptedSequence/m_bDisableAimingWhileMoving */
        disableAimingWhileMoving: boolean;
        /** CScriptedSequence/m_bDisableNPCCollisions */
        disableNPCCollisions: boolean;
        /** CScriptedSequence/m_bDisallowInterrupts */
        disallowInterrupts: boolean;
        /** CScriptedSequence/m_bDontAddModifiers */
        dontAddModifiers: boolean;
        /** CScriptedSequence/m_bDontCancelOtherSequences */
        dontCancelOtherSequences: boolean;
        /** CScriptedSequence/m_bDontRotateOther */
        dontRotateOther: boolean;
        /** CScriptedSequence/m_bDontTeleportAtEnd */
        dontTeleportAtEnd: boolean;
        /** CScriptedSequence/m_bEnsureOnNavmeshOnFinish */
        ensureOnNavmeshOnFinish: boolean;
        /** CScriptedSequence/m_iszEntity — Read-only, as every string field is. */
        readonly entity: string;
        /** CScriptedSequence/m_iszEntry — Read-only, as every string field is. */
        readonly entry: string;
        /** CScriptedSequence/m_bForceSynch */
        forceSynch: boolean;
        /** CScriptedSequence/m_nForcedCrouchState — A ForcedCrouchState_t. */
        forcedCrouchState: number;
        /** CScriptedSequence/m_hForcedTarget — Another entity, or null when it points at nothing. Read-only. */
        readonly forcedTarget: Entity<EntityRaw> | null;
        /** CScriptedSequence/m_nHeldWeaponBehavior — A ScriptedHeldWeaponBehavior_t. */
        heldWeaponBehavior: number;
        /** CScriptedSequence/m_bHideDebugComplaints */
        hideDebugComplaints: boolean;
        /** CScriptedSequence/m_bHighPriority */
        highPriority: boolean;
        /** CScriptedSequence/m_bIgnoreGravity */
        ignoreGravity: boolean;
        /** CScriptedSequence/m_bIgnoreLookAt */
        ignoreLookAt: boolean;
        /** CScriptedSequence/m_bIgnoreRotation */
        ignoreRotation: boolean;
        /** CScriptedSequence/m_bInitiatedSelfDelete */
        initiatedSelfDelete: boolean;
        /** CScriptedSequence/m_hInteractionMainEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly interactionMainEntity: Entity<EntityRaw> | null;
        /** CScriptedSequence/m_bInterruptable */
        interruptable: boolean;
        /** CScriptedSequence/m_bIsPlayingAction */
        isPlayingAction: boolean;
        /** CScriptedSequence/m_bIsPlayingEntry */
        isPlayingEntry: boolean;
        /** CScriptedSequence/m_bIsPlayingPostIdle */
        isPlayingPostIdle: boolean;
        /** CScriptedSequence/m_bIsPlayingPreIdle */
        isPlayingPreIdle: boolean;
        /** CScriptedSequence/m_bIsRepeatable */
        isRepeatable: boolean;
        /** CScriptedSequence/m_bIsTeleportingDueToMoveTo */
        isTeleportingDueToMoveTo: boolean;
        /** CScriptedSequence/m_bKeepAnimgraphLockedPost */
        keepAnimgraphLockedPost: boolean;
        /** CScriptedSequence/m_bLoopActionSequence */
        loopActionSequence: boolean;
        /** CScriptedSequence/m_bLoopPostIdleSequence */
        loopPostIdleSequence: boolean;
        /** CScriptedSequence/m_bLoopPreIdleSequence */
        loopPreIdleSequence: boolean;
        /** CScriptedSequence/m_iszModifierToAddOnPlay — Read-only, as every string field is. */
        readonly modifierToAddOnPlay: string;
        /** CScriptedSequence/m_flMoveInterpTime */
        moveInterpTime: number;
        /** CScriptedSequence/m_flMoveSpeed */
        moveSpeed: number;
        /** CScriptedSequence/m_nMoveTo — A ScriptedMoveTo_t. */
        moveTo: number;
        /** CScriptedSequence/m_nMoveToGait — A SharedMovementGait_t. */
        moveToGait: number;
        /** CScriptedSequence/m_hNextCine — Another entity, or null when it points at nothing. Read-only. */
        readonly nextCine: Entity<EntityRaw> | null;
        /** CScriptedSequence/m_iszNextScript — Read-only, as every string field is. */
        readonly nextScript: string;
        /** CScriptedSequence/m_nNotReadySequenceCount */
        notReadySequenceCount: number;
        /** CScriptedSequence/m_onDeathBehavior — A ScriptedOnDeath_t. */
        onDeathBehavior: number;
        /** CScriptedSequence/m_iszPlay — Read-only, as every string field is. */
        readonly play: string;
        /** CScriptedSequence/m_flPlayAnimFadeInTime */
        playAnimFadeInTime: number;
        /** CScriptedSequence/m_iPlayerDeathBehavior */
        playerDeathBehavior: number;
        /** CScriptedSequence/m_bPositionRelativeToOtherEntity */
        positionRelativeToOtherEntity: boolean;
        /** CScriptedSequence/m_iszPostIdle — Read-only, as every string field is. */
        readonly postIdle: string;
        /** CScriptedSequence/m_iszPreIdle — Read-only, as every string field is. */
        readonly preIdle: string;
        /** CScriptedSequence/m_bPreventUpdateYawOnFinish */
        preventUpdateYawOnFinish: boolean;
        /** CScriptedSequence/m_flRadius */
        radius: number;
        /** CScriptedSequence/m_flRepeat */
        repeat: number;
        /** CScriptedSequence/m_savedCollisionGroup */
        savedCollisionGroup: number;
        /** CScriptedSequence/m_savedFlags */
        savedFlags: number;
        /** CScriptedSequence/m_saved_effects */
        saved_effects: number;
        /** CScriptedSequence/m_sequenceStarted */
        sequenceStarted: boolean;
        /** CScriptedSequence/m_bShouldLeaveCorpse */
        shouldLeaveCorpse: boolean;
        /** CScriptedSequence/m_bSkipFadeIn */
        skipFadeIn: boolean;
        /** CScriptedSequence/m_bStartOnSpawn */
        startOnSpawn: boolean;
        /** CScriptedSequence/m_startTime */
        startTime: number;
        /** CScriptedSequence/m_iszSyncGroup — Read-only, as every string field is. */
        readonly syncGroup: string;
        /** CScriptedSequence/m_bSynchPostIdles */
        synchPostIdles: boolean;
        /** CScriptedSequence/m_hTargetEnt — Another entity, or null when it points at nothing. Read-only. */
        readonly targetEnt: Entity<EntityRaw> | null;
        /** CScriptedSequence/m_bThinking */
        thinking: boolean;
        /** CScriptedSequence/m_bWaitForBeginSequence */
        waitForBeginSequence: boolean;
        /** CScriptedSequence/m_bWaitUntilMoveCompletesToStartAnimation */
        waitUntilMoveCompletesToStartAnimation: boolean;
    }

    /** The fields a CServerOnlyEntity adds to EntityRaw. */
    interface CServerOnlyEntityRaw extends EntityRaw {
    }

    /** The fields a CSkyCamera adds to EntityRaw. */
    interface CSkyCameraRaw extends EntityRaw {
        /** CSkyCamera/m_bUseAngles */
        useAngles: boolean;
    }

    /** The fields a CSkyboxReference adds to EntityRaw. */
    interface CSkyboxReferenceRaw extends EntityRaw {
        /** CSkyboxReference/m_hSkyCamera — Another entity, or null when it points at nothing. Read-only. */
        readonly skyCamera: Entity<EntityRaw> | null;
    }

    /** The fields a CSoundAreaEntityBase adds to EntityRaw. */
    interface CSoundAreaEntityBaseRaw extends EntityRaw {
        /** CSoundAreaEntityBase/m_bDisabled */
        disabled: boolean;
        /** CSoundAreaEntityBase/m_iszSoundAreaType — Read-only, as every string field is. */
        readonly soundAreaType: string;
    }

    /** The fields a CSoundEventEntity adds to EntityRaw. */
    interface CSoundEventEntityRaw extends EntityRaw {
        /** CSoundEventEntity/m_iszAttachmentName — Read-only, as every string field is. */
        readonly attachmentName: string;
        /** CSoundEventEntity/m_flClientCullRadius */
        clientCullRadius: number;
        /** CSoundEventEntity/m_nEntityIndexSelection */
        entityIndexSelection: number;
        /** CSoundEventEntity/m_bSaveRestore */
        saveRestore: boolean;
        /** CSoundEventEntity/m_flSavedElapsedTime */
        savedElapsedTime: number;
        /** CSoundEventEntity/m_bSavedIsPlaying */
        savedIsPlaying: boolean;
        /** CSoundEventEntity/m_iszSoundName — Read-only, as every string field is. */
        readonly soundName: string;
        /** CSoundEventEntity/m_hSource — Another entity, or null when it points at nothing. Read-only. */
        readonly source: Entity<EntityRaw> | null;
        /** CSoundEventEntity/m_iszSourceEntityName — Read-only, as every string field is. */
        readonly sourceEntityName: string;
        /** CSoundEventEntity/m_bStartOnSpawn */
        startOnSpawn: boolean;
        /** CSoundEventEntity/m_bStopOnNew */
        stopOnNew: boolean;
        /** CSoundEventEntity/m_bToLocalPlayer */
        toLocalPlayer: boolean;
    }

    /** The fields a CSoundEventParameter adds to EntityRaw. */
    interface CSoundEventParameterRaw extends EntityRaw {
        /** CSoundEventParameter/m_flFloatValue */
        floatValue: number;
        /** CSoundEventParameter/m_iszParamName — Read-only, as every string field is. */
        readonly paramName: string;
    }

    /** The fields a CSoundOpvarSetEntity adds to EntityRaw. */
    interface CSoundOpvarSetEntityRaw extends EntityRaw {
        /** CSoundOpvarSetEntity/m_iszOperatorName — Read-only, as every string field is. */
        readonly operatorName: string;
        /** CSoundOpvarSetEntity/m_nOpvarIndex */
        opvarIndex: number;
        /** CSoundOpvarSetEntity/m_iszOpvarName — Read-only, as every string field is. */
        readonly opvarName: string;
        /** CSoundOpvarSetEntity/m_nOpvarType */
        opvarType: number;
        /** CSoundOpvarSetEntity/m_flOpvarValue */
        opvarValue: number;
        /** CSoundOpvarSetEntity/m_OpvarValueString — Read-only, as every string field is. */
        readonly opvarValueString: string;
        /** CSoundOpvarSetEntity/m_bSetOnSpawn */
        setOnSpawn: boolean;
        /** CSoundOpvarSetEntity/m_iszStackName — Read-only, as every string field is. */
        readonly stackName: string;
    }

    /** The fields a CSoundOpvarSetPointBase adds to EntityRaw. */
    interface CSoundOpvarSetPointBaseRaw extends EntityRaw {
        /** CSoundOpvarSetPointBase/m_bDisabled */
        disabled: boolean;
        /** CSoundOpvarSetPointBase/m_bFastRefresh */
        fastRefresh: boolean;
        /** CSoundOpvarSetPointBase/m_iszOperatorName — Read-only, as every string field is. */
        readonly operatorName: string;
        /** CSoundOpvarSetPointBase/m_iOpvarIndex */
        opvarIndex: number;
        /** CSoundOpvarSetPointBase/m_iszOpvarName — Read-only, as every string field is. */
        readonly opvarName: string;
        /** CSoundOpvarSetPointBase/m_flRefreshTime */
        refreshTime: number;
        /** CSoundOpvarSetPointBase/m_hSource — Another entity, or null when it points at nothing. Read-only. */
        readonly source: Entity<EntityRaw> | null;
        /** CSoundOpvarSetPointBase/m_iszSourceEntityName — Read-only, as every string field is. */
        readonly sourceEntityName: string;
        /** CSoundOpvarSetPointBase/m_iszStackName — Read-only, as every string field is. */
        readonly stackName: string;
        /** CSoundOpvarSetPointBase/m_bUseAutoCompare */
        useAutoCompare: boolean;
    }

    /** The fields a CTeam adds to EntityRaw. */
    interface CTeamRaw extends EntityRaw {
        /** CTeam/m_iScore */
        score: number;
        /** CTeam/m_szTeamname — Read-only, as every string field is. */
        readonly teamname: string;
    }

    /** The fields a CTestEffect adds to EntityRaw. */
    interface CTestEffectRaw extends EntityRaw {
        /** CTestEffect/m_iBeam */
        iBeam: number;
        /** CTestEffect/m_iLoop */
        loop: number;
        /** CTestEffect/m_flStartTime */
        startTime: number;
    }

    /** The fields a CTonemapController2 adds to EntityRaw. */
    interface CTonemapController2Raw extends EntityRaw {
        /** CTonemapController2/m_flAutoExposureMax */
        autoExposureMax: number;
        /** CTonemapController2/m_flAutoExposureMin */
        autoExposureMin: number;
        /** CTonemapController2/m_flExposureAdaptationSpeedDown */
        exposureAdaptationSpeedDown: number;
        /** CTonemapController2/m_flExposureAdaptationSpeedUp */
        exposureAdaptationSpeedUp: number;
        /** CTonemapController2/m_flTonemapEVSmoothingRange */
        tonemapEVSmoothingRange: number;
    }

    /** The fields a CVoteController adds to EntityRaw. */
    interface CVoteControllerRaw extends EntityRaw {
        /** CVoteController/m_iActiveIssueIndex */
        activeIssueIndex: number;
        /** CVoteController/m_nHighestCountIndex */
        highestCountIndex: number;
        /** CVoteController/m_bIsYesNoVote */
        isYesNoVote: boolean;
        /** CVoteController/m_iOnlyTeamToVote */
        onlyTeamToVote: number;
        /** CVoteController/m_playerHoldingVote */
        playerHoldingVote: number;
        /** CVoteController/m_playerOverrideForVote */
        playerOverrideForVote: number;
        /** CVoteController/m_nPotentialVotes */
        potentialVotes: number;
    }

    /** The fields a CAmbientGeneric adds to CPointEntityRaw. */
    interface CAmbientGenericRaw extends CPointEntityRaw {
        /** CAmbientGeneric/m_fActive */
        active: boolean;
        /** CAmbientGeneric/m_fLooping */
        looping: boolean;
        /** CAmbientGeneric/m_flMaxRadius */
        maxRadius: number;
        /** CAmbientGeneric/m_radius */
        radius: number;
        /** CAmbientGeneric/m_iszSound — Read-only, as every string field is. */
        readonly sound: string;
        /** CAmbientGeneric/m_iSoundLevel — A soundlevel_t. */
        soundLevel: number;
        /** CAmbientGeneric/m_hSoundSource — Another entity, or null when it points at nothing. Read-only. */
        readonly soundSource: Entity<EntityRaw> | null;
        /** CAmbientGeneric/m_sSourceEntName — Read-only, as every string field is. */
        readonly sourceEntName: string;
    }

    /** The fields a CBarnLight adds to CBaseModelEntityRaw. */
    interface CBarnLightRaw extends CBaseModelEntityRaw {
        /** CBarnLight/m_fAlternateColorBrightness */
        alternateColorBrightness: number;
        /** CBarnLight/m_nBakeSpecularToCubemaps */
        bakeSpecularToCubemaps: number;
        /** CBarnLight/m_flBakeSpecularToCubemapsScale */
        bakeSpecularToCubemapsScale: number;
        /** CBarnLight/m_nBakedShadowIndex */
        bakedShadowIndex: number;
        /** CBarnLight/m_nBounceLight */
        bounceLight: number;
        /** CBarnLight/m_flBounceScale */
        bounceScale: number;
        /** CBarnLight/m_flBrightness */
        brightness: number;
        /** CBarnLight/m_flBrightnessScale */
        brightnessScale: number;
        /** CBarnLight/m_nCastShadows */
        castShadows: number;
        /** CBarnLight/m_nColorMode */
        colorMode: number;
        /** CBarnLight/m_flColorTemperature */
        colorTemperature: number;
        /** CBarnLight/m_bContactShadow */
        contactShadow: boolean;
        /** CBarnLight/m_nDirectLight */
        directLight: number;
        /** CBarnLight/m_bEnabled */
        enabled: boolean;
        /** CBarnLight/m_flFadeSizeEnd */
        fadeSizeEnd: number;
        /** CBarnLight/m_flFadeSizeStart */
        fadeSizeStart: number;
        /** CBarnLight/m_nFog */
        fog: number;
        /** CBarnLight/m_flFogScale */
        fogScale: number;
        /** CBarnLight/m_nFogShadows */
        fogShadows: number;
        /** CBarnLight/m_flFogStrength */
        fogStrength: number;
        /** CBarnLight/m_bForceShadowsEnabled */
        forceShadowsEnabled: boolean;
        /** CBarnLight/m_nLightMapUniqueId */
        lightMapUniqueId: number;
        /** CBarnLight/m_nLightPathUniqueId */
        lightPathUniqueId: number;
        /** CBarnLight/m_flLightStyleStartTime */
        lightStyleStartTime: number;
        /** CBarnLight/m_LightStyleString — Read-only, as every string field is. */
        readonly lightStyleString: string;
        /** CBarnLight/m_flLuminaireAnisotropy */
        luminaireAnisotropy: number;
        /** CBarnLight/m_nLuminaireShape */
        luminaireShape: number;
        /** CBarnLight/m_flLuminaireSize */
        luminaireSize: number;
        /** CBarnLight/m_flMinRoughness */
        minRoughness: number;
        /** CBarnLight/m_bPrecomputedFieldsValid */
        precomputedFieldsValid: boolean;
        /** CBarnLight/m_nPrecomputedSubFrusta */
        precomputedSubFrusta: number;
        /** CBarnLight/m_bPvsModifyEntity */
        pvsModifyEntity: boolean;
        /** CBarnLight/m_flRange */
        range: number;
        /** CBarnLight/m_flShadowFadeSizeEnd */
        shadowFadeSizeEnd: number;
        /** CBarnLight/m_flShadowFadeSizeStart */
        shadowFadeSizeStart: number;
        /** CBarnLight/m_nShadowMapSize */
        shadowMapSize: number;
        /** CBarnLight/m_nShadowPriority */
        shadowPriority: number;
        /** CBarnLight/m_flShape */
        shape: number;
        /** CBarnLight/m_flSkirt */
        skirt: number;
        /** CBarnLight/m_flSkirtNear */
        skirtNear: number;
        /** CBarnLight/m_flSoftX */
        softX: number;
        /** CBarnLight/m_flSoftY */
        softY: number;
        /** CBarnLight/m_bTransmitAlways */
        transmitAlways: boolean;
    }

    /** The fields a CBaseAnimGraph adds to CBaseModelEntityRaw. */
    interface CBaseAnimGraphRaw extends CBaseModelEntityRaw {
        /** CBaseAnimGraph/m_bAnimGraphUpdateEnabled */
        animGraphUpdateEnabled: boolean;
        /** CBaseAnimGraph/m_bAnimationUpdateScheduled */
        animationUpdateScheduled: boolean;
        /** CBaseAnimGraph/m_nForceBone */
        forceBone: number;
        /** CBaseAnimGraph/m_bInitiallyPopulateInterpHistory */
        initiallyPopulateInterpHistory: boolean;
        /** CBaseAnimGraph/m_bRagdollClientSide */
        ragdollClientSide: boolean;
        /** CBaseAnimGraph/m_bRagdollEnabled */
        ragdollEnabled: boolean;
    }

    /** The fields a CBaseClientUIEntity adds to CBaseModelEntityRaw. */
    interface CBaseClientUIEntityRaw extends CBaseModelEntityRaw {
        /** CBaseClientUIEntity/m_DialogXMLName — Read-only, as every string field is. */
        readonly dialogXMLName: string;
        /** CBaseClientUIEntity/m_bEnabled */
        enabled: boolean;
        /** CBaseClientUIEntity/m_PanelClassName — Read-only, as every string field is. */
        readonly panelClassName: string;
        /** CBaseClientUIEntity/m_PanelID — Read-only, as every string field is. */
        readonly panelID: string;
    }

    /** The fields a CBaseDMStart adds to CPointEntityRaw. */
    interface CBaseDMStartRaw extends CPointEntityRaw {
        /** CBaseDMStart/m_Master — Read-only, as every string field is. */
        readonly master: string;
    }

    /** The fields a CBaseToggle adds to CBaseModelEntityRaw. */
    interface CBaseToggleRaw extends CBaseModelEntityRaw {
        /** CBaseToggle/m_hActivator — Another entity, or null when it points at nothing. Read-only. */
        readonly activator: Entity<EntityRaw> | null;
        /** CBaseToggle/m_bAlwaysFireBlockedOutputs */
        alwaysFireBlockedOutputs: boolean;
        /** CBaseToggle/m_flHeight */
        height: number;
        /** CBaseToggle/m_flLip */
        lip: number;
        /** CBaseToggle/m_sMaster — Read-only, as every string field is. */
        readonly master: string;
        /** CBaseToggle/m_flMoveDistance */
        moveDistance: number;
        /** CBaseToggle/m_movementType */
        movementType: number;
        /** CBaseToggle/m_toggle_state — A TOGGLE_STATE. */
        toggle_state: number;
        /** CBaseToggle/m_flWait */
        wait: number;
    }

    /** The fields a CBeam adds to CBaseModelEntityRaw. */
    interface CBeamRaw extends CBaseModelEntityRaw {
        /** CBeam/m_fAmplitude */
        amplitude: number;
        /** CBeam/m_nBeamFlags */
        beamFlags: number;
        /** CBeam/m_nBeamType — A BeamType_t. */
        beamType: number;
        /** CBeam/m_flDamage */
        damage: number;
        /** CBeam/m_nDissolveType */
        dissolveType: number;
        /** CBeam/m_hEndEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly endEntity: Entity<EntityRaw> | null;
        /** CBeam/m_fEndWidth */
        endWidth: number;
        /** CBeam/m_fFadeLength */
        fadeLength: number;
        /** CBeam/m_flFireTime */
        fireTime: number;
        /** CBeam/m_flFrame */
        frame: number;
        /** CBeam/m_flFrameRate */
        frameRate: number;
        /** CBeam/m_flHDRColorScale */
        hDRColorScale: number;
        /** CBeam/m_fHaloScale */
        haloScale: number;
        /** CBeam/m_nNumBeamEnts */
        numBeamEnts: number;
        /** CBeam/m_fSpeed */
        speed: number;
        /** CBeam/m_fStartFrame */
        startFrame: number;
        /** CBeam/m_bTurnedOff */
        turnedOff: boolean;
        /** CBeam/m_fWidth */
        width: number;
    }

    /** The fields a CBlood adds to CPointEntityRaw. */
    interface CBloodRaw extends CPointEntityRaw {
        /** CBlood/m_flAmount */
        amount: number;
        /** CBlood/m_Color — A BloodType. */
        color: number;
    }

    /** The fields a CBreakable adds to CBaseModelEntityRaw. */
    interface CBreakableRaw extends CBaseModelEntityRaw {
        /** CBreakable/m_hBreaker — Another entity, or null when it points at nothing. Read-only. */
        readonly breaker: Entity<EntityRaw> | null;
        /** CBreakable/m_Explosion — A Explosions. */
        explosion: number;
        /** CBreakable/m_impactEnergyScale */
        impactEnergyScale: number;
        /** CBreakable/m_flLastPhysicsInfluenceTime */
        lastPhysicsInfluenceTime: number;
        /** CBreakable/m_Material — A Materials. */
        material: number;
        /** CBreakable/m_iMinHealthDmg */
        minHealthDmg: number;
        /** CBreakable/m_nOverrideBlockLOS — A EOverrideBlockLOS_t. */
        overrideBlockLOS: number;
        /** CBreakable/m_PerformanceMode — A PerformanceMode_t. */
        performanceMode: number;
        /** CBreakable/m_hPhysicsAttacker — Another entity, or null when it points at nothing. Read-only. */
        readonly physicsAttacker: Entity<EntityRaw> | null;
        /** CBreakable/m_flPressureDelay */
        pressureDelay: number;
        /** CBreakable/m_iszPropData — Read-only, as every string field is. */
        readonly propData: string;
        /** CBreakable/m_iszSpawnObject — Read-only, as every string field is. */
        readonly spawnObject: string;
    }

    /** The fields a CCSGO_EndOfMatchLineupEnd adds to CCSGO_EndOfMatchLineupEndpointRaw. */
    interface CCSGO_EndOfMatchLineupEndRaw extends CCSGO_EndOfMatchLineupEndpointRaw {
    }

    /** The fields a CCSGO_EndOfMatchLineupStart adds to CCSGO_EndOfMatchLineupEndpointRaw. */
    interface CCSGO_EndOfMatchLineupStartRaw extends CCSGO_EndOfMatchLineupEndpointRaw {
    }

    /** The fields a CCSGO_TeamIntroCharacterPosition adds to CCSGO_TeamPreviewCharacterPositionRaw. */
    interface CCSGO_TeamIntroCharacterPositionRaw extends CCSGO_TeamPreviewCharacterPositionRaw {
    }

    /** The fields a CCSGO_TeamSelectCharacterPosition adds to CCSGO_TeamPreviewCharacterPositionRaw. */
    interface CCSGO_TeamSelectCharacterPositionRaw extends CCSGO_TeamPreviewCharacterPositionRaw {
    }

    /** The fields a CCSGameRulesProxy adds to CGameRulesProxyRaw. */
    interface CCSGameRulesProxyRaw extends CGameRulesProxyRaw {
    }

    /** The fields a CCSPlayerController adds to CBasePlayerControllerRaw. */
    interface ControllerRaw extends CBasePlayerControllerRaw {
        /** CCSPlayerController/m_bAbandonAllowsSurrender */
        abandonAllowsSurrender: boolean;
        /** CCSPlayerController/m_bAbandonOffersInstantSurrender */
        abandonOffersInstantSurrender: boolean;
        /** CCSPlayerController/m_unActiveQuestId */
        activeQuestId: number;
        /** CCSPlayerController/m_bAttemptedToGetColor */
        attemptedToGetColor: boolean;
        /** CCSPlayerController/m_nBotsControlledThisRound */
        botsControlledThisRound: number;
        /** CCSPlayerController/m_bCanControlObservedBot */
        canControlObservedBot: boolean;
        /** CCSPlayerController/m_bCannotBeKicked */
        cannotBeKicked: boolean;
        /** CCSPlayerController/m_szClan — Read-only, as every string field is. */
        readonly clan: string;
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
        /** CCSPlayerController/m_bControllingBot */
        controllingBot: boolean;
        /** CCSPlayerController/m_szCrosshairCodes — Read-only, as every string field is. */
        readonly crosshairCodes: string;
        /** CCSPlayerController/m_dblLastReceivedPacketPlatFloatTime */
        dblLastReceivedPacketPlatFloatTime: number;
        /** CCSPlayerController/m_DesiredObserverMode */
        desiredObserverMode: number;
        /** CCSPlayerController/m_hDesiredObserverTarget — Another entity, or null when it points at nothing. Read-only. */
        readonly desiredObserverTarget: Entity<EntityRaw> | null;
        /** CCSPlayerController/m_bDisconnection1MinWarningPrinted */
        disconnection1MinWarningPrinted: boolean;
        /** CCSPlayerController/m_nDisconnectionTick */
        disconnectionTick: number;
        /** CCSPlayerController/m_iDraftIndex */
        draftIndex: number;
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
        /** CCSPlayerController/m_flForceTeamTime */
        forceTeamTime: number;
        /** CCSPlayerController/m_bGaveTeamDamageWarning */
        gaveTeamDamageWarning: boolean;
        /** CCSPlayerController/m_bGaveTeamDamageWarningThisRound */
        gaveTeamDamageWarningThisRound: boolean;
        /** CCSPlayerController/m_bHasBeenControlledByPlayerThisRound */
        hasBeenControlledByPlayerThisRound: boolean;
        /** CCSPlayerController/m_bHasCommunicationAbuseMute */
        hasCommunicationAbuseMute: boolean;
        /** CCSPlayerController/m_bHasControlledBotThisRound */
        hasControlledBotThisRound: boolean;
        /** CCSPlayerController/m_bHasSeenJoinGame */
        hasSeenJoinGame: boolean;
        /** CCSPlayerController/m_bInSwitchTeam */
        inSwitchTeam: boolean;
        /** CCSPlayerController/m_bJustBecameSpectator */
        justBecameSpectator: boolean;
        /** CCSPlayerController/m_bJustDidTeamKill */
        justDidTeamKill: boolean;
        /** CCSPlayerController/m_nKillCount */
        killCount: number;
        /** CCSPlayerController/m_flLastJoinTeamTime */
        lastJoinTeamTime: number;
        /** CCSPlayerController/m_LastTeamDamageWarningTime */
        lastTeamDamageWarningTime: number;
        /** CCSPlayerController/m_LastTimePlayerWasDisconnectedForPawnsRemove */
        lastTimePlayerWasDisconnectedForPawnsRemove: number;
        /** CCSPlayerController/m_iMVPs */
        mVPs: number;
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
        /** CCSPlayerController/m_eNetworkDisconnectionReason */
        networkDisconnectionReason: number;
        /** CCSPlayerController/m_iNextTimeCheck */
        nextTimeCheck: number;
        /** CCSPlayerController/m_nNonSuspiciousHitStreak */
        nonSuspiciousHitStreak: number;
        /** CCSPlayerController/m_hObserverPawn — Another entity, or null when it points at nothing. Read-only. */
        readonly observerPawn: Entity<EntityRaw> | null;
        /** CCSPlayerController/m_hOriginalControllerOfCurrentPawn — Another entity, or null when it points at nothing. Read-only. */
        readonly originalControllerOfCurrentPawn: Entity<EntityRaw> | null;
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
        /** CCSPlayerController/m_nPlayerDominated — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly playerDominated: string;
        /** CCSPlayerController/m_nPlayerDominatingMe — A 64-bit id, as a string: it does not survive a JavaScript number. */
        readonly playerDominatingMe: string;
        /** CCSPlayerController/m_hPlayerPawn — Another entity, or null when it points at nothing. Read-only. */
        readonly playerPawn: Entity<EntityRaw> | null;
        /** CCSPlayerController/m_unPlayerTvControlFlags */
        playerTvControlFlags: number;
        /** CCSPlayerController/m_bPunishForTeamKill */
        punishForTeamKill: boolean;
        /** CCSPlayerController/m_bRemoveAllItemsOnNextRoundReset */
        removeAllItemsOnNextRoundReset: boolean;
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
        /** CCSPlayerController/m_bShowHints */
        showHints: boolean;
        /** CCSPlayerController/m_flSmoothedPing */
        smoothedPing: number;
        /** CCSPlayerController/m_nSuspiciousHitCount */
        suspiciousHitCount: number;
        /** CCSPlayerController/m_bSwitchTeamsOnNextRoundReset */
        switchTeamsOnNextRoundReset: boolean;
        /** CCSPlayerController/m_bTeamChanged */
        teamChanged: boolean;
        /** CCSPlayerController/m_iTeammatePreferredColor */
        teammatePreferredColor: number;
        /** CCSPlayerController/m_uiAbandonRecordedReason */
        uiAbandonRecordedReason: number;
        /** CCSPlayerController/m_uiCommunicationMuteFlags */
        uiCommunicationMuteFlags: number;
        /** CCSPlayerController/m_nUpdateCounter */
        updateCounter: number;
    }

    /** The fields a CCSTeam adds to CTeamRaw. */
    interface CCSTeamRaw extends CTeamRaw {
        /** CCSTeam/m_iClanID */
        clanID: number;
        /** CCSTeam/m_szClanTeamname — Read-only, as every string field is. */
        readonly clanTeamname: string;
        /** CCSTeam/m_nLastRecievedShorthandedRoundBonus */
        lastRecievedShorthandedRoundBonus: number;
        /** CCSTeam/m_iLastUpdateSentAt */
        lastUpdateSentAt: number;
        /** CCSTeam/m_flNextResourceTime */
        nextResourceTime: number;
        /** CCSTeam/m_numMapVictories */
        numMapVictories: number;
        /** CCSTeam/m_scoreFirstHalf */
        scoreFirstHalf: number;
        /** CCSTeam/m_scoreOvertime */
        scoreOvertime: number;
        /** CCSTeam/m_scoreSecondHalf */
        scoreSecondHalf: number;
        /** CCSTeam/m_nShorthandedRoundBonusStartRound */
        shorthandedRoundBonusStartRound: number;
        /** CCSTeam/m_bSurrendered */
        surrendered: boolean;
        /** CCSTeam/m_szTeamFlagImage — Read-only, as every string field is. */
        readonly teamFlagImage: string;
        /** CCSTeam/m_szTeamLogoImage — Read-only, as every string field is. */
        readonly teamLogoImage: string;
        /** CCSTeam/m_szTeamMatchStat — Read-only, as every string field is. */
        readonly teamMatchStat: string;
    }

    /** The fields a CCashStack adds to CBaseModelEntityRaw. */
    interface CCashStackRaw extends CBaseModelEntityRaw {
        /** CCashStack/m_nCashStackValue */
        cashStackValue: number;
    }

    /** The fields a CChoreoInfoTarget adds to CPointEntityRaw. */
    interface CChoreoInfoTargetRaw extends CPointEntityRaw {
    }

    /** The fields a CCredits adds to CPointEntityRaw. */
    interface CCreditsRaw extends CPointEntityRaw {
        /** CCredits/m_flLogoLength */
        logoLength: number;
        /** CCredits/m_bRolledOutroCredits */
        rolledOutroCredits: boolean;
    }

    /** The fields a CDynamicLight adds to CBaseModelEntityRaw. */
    interface CDynamicLightRaw extends CBaseModelEntityRaw {
        /** CDynamicLight/m_ActualFlags */
        actualFlags: number;
        /** CDynamicLight/m_Flags */
        dynamicLightFlags: number;
        /** CDynamicLight/m_Exponent */
        exponent: number;
        /** CDynamicLight/m_InnerAngle */
        innerAngle: number;
        /** CDynamicLight/m_LightStyle */
        lightStyle: number;
        /** CDynamicLight/m_On */
        on: boolean;
        /** CDynamicLight/m_OuterAngle */
        outerAngle: number;
        /** CDynamicLight/m_Radius */
        radius: number;
        /** CDynamicLight/m_SpotRadius */
        spotRadius: number;
    }

    /** The fields a CEntityBlocker adds to CBaseModelEntityRaw. */
    interface CEntityBlockerRaw extends CBaseModelEntityRaw {
    }

    /** The fields a CEntityDissolve adds to CBaseModelEntityRaw. */
    interface CEntityDissolveRaw extends CBaseModelEntityRaw {
        /** CEntityDissolve/m_nDissolveType — A EntityDissolveType_t. */
        dissolveType: number;
        /** CEntityDissolve/m_flFadeInLength */
        fadeInLength: number;
        /** CEntityDissolve/m_flFadeInStart */
        fadeInStart: number;
        /** CEntityDissolve/m_flFadeOutLength */
        fadeOutLength: number;
        /** CEntityDissolve/m_flFadeOutModelLength */
        fadeOutModelLength: number;
        /** CEntityDissolve/m_flFadeOutModelStart */
        fadeOutModelStart: number;
        /** CEntityDissolve/m_flFadeOutStart */
        fadeOutStart: number;
        /** CEntityDissolve/m_nMagnitude */
        magnitude: number;
        /** CEntityDissolve/m_flStartTime */
        startTime: number;
    }

    /** The fields a CEnvCombinedLightProbeVolumeAlias_func_combined_light_probe_volume adds to CEnvCombinedLightProbeVolumeRaw. */
    interface CEnvCombinedLightProbeVolumeAlias_func_combined_light_probe_volumeRaw extends CEnvCombinedLightProbeVolumeRaw {
    }

    /** The fields a CEnvCubemapBox adds to CEnvCubemapRaw. */
    interface CEnvCubemapBoxRaw extends CEnvCubemapRaw {
    }

    /** The fields a CEnvDecal adds to CBaseModelEntityRaw. */
    interface CEnvDecalRaw extends CBaseModelEntityRaw {
        /** CEnvDecal/m_flDepth */
        depth: number;
        /** CEnvDecal/m_flDepthSortBias */
        depthSortBias: number;
        /** CEnvDecal/m_flHeight */
        height: number;
        /** CEnvDecal/m_bProjectOnCharacters */
        projectOnCharacters: boolean;
        /** CEnvDecal/m_bProjectOnWater */
        projectOnWater: boolean;
        /** CEnvDecal/m_bProjectOnWorld */
        projectOnWorld: boolean;
        /** CEnvDecal/m_nRenderOrder */
        renderOrder: number;
        /** CEnvDecal/m_flWidth */
        width: number;
    }

    /** The fields a CEnvEntityMaker adds to CPointEntityRaw. */
    interface CEnvEntityMakerRaw extends CPointEntityRaw {
        /** CEnvEntityMaker/m_hCurrentBlocker — Another entity, or null when it points at nothing. Read-only. */
        readonly currentBlocker: Entity<EntityRaw> | null;
        /** CEnvEntityMaker/m_hCurrentInstance — Another entity, or null when it points at nothing. Read-only. */
        readonly currentInstance: Entity<EntityRaw> | null;
        /** CEnvEntityMaker/m_flPostSpawnDirectionVariance */
        postSpawnDirectionVariance: number;
        /** CEnvEntityMaker/m_flPostSpawnSpeed */
        postSpawnSpeed: number;
        /** CEnvEntityMaker/m_bPostSpawnUseAngles */
        postSpawnUseAngles: boolean;
        /** CEnvEntityMaker/m_iszTemplate — Read-only, as every string field is. */
        readonly template: string;
    }

    /** The fields a CEnvHudHint adds to CPointEntityRaw. */
    interface CEnvHudHintRaw extends CPointEntityRaw {
        /** CEnvHudHint/m_iszMessage — Read-only, as every string field is. */
        readonly message: string;
    }

    /** The fields a CEnvInstructorHint adds to CPointEntityRaw. */
    interface CEnvInstructorHintRaw extends CPointEntityRaw {
        /** CEnvInstructorHint/m_iszActivatorCaption — Read-only, as every string field is. */
        readonly activatorCaption: string;
        /** CEnvInstructorHint/m_bAllowNoDrawTarget */
        allowNoDrawTarget: boolean;
        /** CEnvInstructorHint/m_iAlphaOption */
        alphaOption: number;
        /** CEnvInstructorHint/m_bAutoStart */
        autoStart: boolean;
        /** CEnvInstructorHint/m_iszBinding — Read-only, as every string field is. */
        readonly binding: string;
        /** CEnvInstructorHint/m_iszCaption — Read-only, as every string field is. */
        readonly caption: string;
        /** CEnvInstructorHint/m_iDisplayLimit */
        displayLimit: number;
        /** CEnvInstructorHint/m_bForceCaption */
        forceCaption: boolean;
        /** CEnvInstructorHint/m_iszHintTargetEntity — Read-only, as every string field is. */
        readonly hintTargetEntity: string;
        /** CEnvInstructorHint/m_fIconOffset */
        iconOffset: number;
        /** CEnvInstructorHint/m_iszIcon_Offscreen — Read-only, as every string field is. */
        readonly icon_Offscreen: string;
        /** CEnvInstructorHint/m_iszIcon_Onscreen — Read-only, as every string field is. */
        readonly icon_Onscreen: string;
        /** CEnvInstructorHint/m_iInstanceType */
        instanceType: number;
        /** CEnvInstructorHint/m_bLocalPlayerOnly */
        localPlayerOnly: boolean;
        /** CEnvInstructorHint/m_iszName — Read-only, as every string field is. */
        readonly name: string;
        /** CEnvInstructorHint/m_bNoOffscreen */
        noOffscreen: boolean;
        /** CEnvInstructorHint/m_iPulseOption */
        pulseOption: number;
        /** CEnvInstructorHint/m_fRange */
        range: number;
        /** CEnvInstructorHint/m_iszReplace_Key — Read-only, as every string field is. */
        readonly replace_Key: string;
        /** CEnvInstructorHint/m_iShakeOption */
        shakeOption: number;
        /** CEnvInstructorHint/m_bStatic */
        static: boolean;
        /** CEnvInstructorHint/m_bSuppressRest */
        suppressRest: boolean;
        /** CEnvInstructorHint/m_iTimeout */
        timeout: number;
    }

    /** The fields a CEnvInstructorVRHint adds to CPointEntityRaw. */
    interface CEnvInstructorVRHintRaw extends CPointEntityRaw {
        /** CEnvInstructorVRHint/m_iAttachType */
        attachType: number;
        /** CEnvInstructorVRHint/m_iszCaption — Read-only, as every string field is. */
        readonly caption: string;
        /** CEnvInstructorVRHint/m_iszCustomLayoutFile — Read-only, as every string field is. */
        readonly customLayoutFile: string;
        /** CEnvInstructorVRHint/m_flHeightOffset */
        heightOffset: number;
        /** CEnvInstructorVRHint/m_iszHintTargetEntity — Read-only, as every string field is. */
        readonly hintTargetEntity: string;
        /** CEnvInstructorVRHint/m_iLayoutFileType */
        layoutFileType: number;
        /** CEnvInstructorVRHint/m_iszName — Read-only, as every string field is. */
        readonly name: string;
        /** CEnvInstructorVRHint/m_iszStartSound — Read-only, as every string field is. */
        readonly startSound: string;
        /** CEnvInstructorVRHint/m_iTimeout */
        timeout: number;
    }

    /** The fields a CEnvMuzzleFlash adds to CPointEntityRaw. */
    interface CEnvMuzzleFlashRaw extends CPointEntityRaw {
        /** CEnvMuzzleFlash/m_iszParentAttachment — Read-only, as every string field is. */
        readonly parentAttachment: string;
        /** CEnvMuzzleFlash/m_flScale */
        scale: number;
    }

    /** The fields a CEnvShake adds to CPointEntityRaw. */
    interface CEnvShakeRaw extends CPointEntityRaw {
        /** CEnvShake/m_Amplitude */
        amplitude: number;
        /** CEnvShake/m_currentAmp */
        currentAmp: number;
        /** CEnvShake/m_Duration */
        duration: number;
        /** CEnvShake/m_Frequency */
        frequency: number;
        /** CEnvShake/m_limitToEntity — Read-only, as every string field is. */
        readonly limitToEntity: string;
        /** CEnvShake/m_nextShake */
        nextShake: number;
        /** CEnvShake/m_Radius */
        radius: number;
        /** CEnvShake/m_stopTime */
        stopTime: number;
    }

    /** The fields a CEnvSky adds to CBaseModelEntityRaw. */
    interface CEnvSkyRaw extends CBaseModelEntityRaw {
        /** CEnvSky/m_flBrightnessScale */
        brightnessScale: number;
        /** CEnvSky/m_bEnabled */
        enabled: boolean;
        /** CEnvSky/m_flFogMaxEnd */
        fogMaxEnd: number;
        /** CEnvSky/m_flFogMaxStart */
        fogMaxStart: number;
        /** CEnvSky/m_flFogMinEnd */
        fogMinEnd: number;
        /** CEnvSky/m_flFogMinStart */
        fogMinStart: number;
        /** CEnvSky/m_nFogType */
        fogType: number;
        /** CEnvSky/m_bStartDisabled */
        startDisabled: boolean;
    }

    /** The fields a CEnvSoundscapeAlias_snd_soundscape adds to CEnvSoundscapeRaw. */
    interface CEnvSoundscapeAlias_snd_soundscapeRaw extends CEnvSoundscapeRaw {
    }

    /** The fields a CEnvSoundscapeProxy adds to CEnvSoundscapeRaw. */
    interface CEnvSoundscapeProxyRaw extends CEnvSoundscapeRaw {
        /** CEnvSoundscapeProxy/m_MainSoundscapeName — Read-only, as every string field is. */
        readonly mainSoundscapeName: string;
    }

    /** The fields a CEnvSoundscapeTriggerable adds to CEnvSoundscapeRaw. */
    interface CEnvSoundscapeTriggerableRaw extends CEnvSoundscapeRaw {
    }

    /** The fields a CEnvSpark adds to CPointEntityRaw. */
    interface CEnvSparkRaw extends CPointEntityRaw {
        /** CEnvSpark/m_flDelay */
        delay: number;
        /** CEnvSpark/m_nMagnitude */
        magnitude: number;
        /** CEnvSpark/m_nTrailLength */
        trailLength: number;
        /** CEnvSpark/m_nType */
        type: number;
    }

    /** The fields a CEnvSplash adds to CPointEntityRaw. */
    interface CEnvSplashRaw extends CPointEntityRaw {
        /** CEnvSplash/m_flScale */
        scale: number;
    }

    /** The fields a CEnvTilt adds to CPointEntityRaw. */
    interface CEnvTiltRaw extends CPointEntityRaw {
        /** CEnvTilt/m_Duration */
        duration: number;
        /** CEnvTilt/m_Radius */
        radius: number;
        /** CEnvTilt/m_stopTime */
        stopTime: number;
        /** CEnvTilt/m_TiltTime */
        tiltTime: number;
    }

    /** The fields a CEnvViewPunch adds to CPointEntityRaw. */
    interface CEnvViewPunchRaw extends CPointEntityRaw {
        /** CEnvViewPunch/m_flRadius */
        radius: number;
    }

    /** The fields a CFuncBrush adds to CBaseModelEntityRaw. */
    interface CFuncBrushRaw extends CBaseModelEntityRaw {
        /** CFuncBrush/m_iDisabled */
        disabled: number;
        /** CFuncBrush/m_iszExcludedClass — Read-only, as every string field is. */
        readonly excludedClass: string;
        /** CFuncBrush/m_bInvertExclusion */
        invertExclusion: boolean;
        /** CFuncBrush/m_bScriptedMovement */
        scriptedMovement: boolean;
        /** CFuncBrush/m_bSolidBsp */
        solidBsp: boolean;
        /** CFuncBrush/m_iSolidity — A BrushSolidities_e. */
        solidity: number;
    }

    /** The fields a CFuncConveyor adds to CBaseModelEntityRaw. */
    interface CFuncConveyorRaw extends CBaseModelEntityRaw {
        /** CFuncConveyor/m_flSpeed */
        speed: number;
        /** CFuncConveyor/m_szConveyorModels — Read-only, as every string field is. */
        readonly szConveyorModels: string;
        /** CFuncConveyor/m_flTargetSpeed */
        targetSpeed: number;
        /** CFuncConveyor/m_flTransitionDurationSeconds */
        transitionDurationSeconds: number;
        /** CFuncConveyor/m_nTransitionDurationTicks */
        transitionDurationTicks: number;
        /** CFuncConveyor/m_flTransitionStartSpeed */
        transitionStartSpeed: number;
        /** CFuncConveyor/m_nTransitionStartTick */
        transitionStartTick: number;
    }

    /** The fields a CFuncIllusionary adds to CBaseModelEntityRaw. */
    interface CFuncIllusionaryRaw extends CBaseModelEntityRaw {
    }

    /** The fields a CFuncInteractionLayerClip adds to CBaseModelEntityRaw. */
    interface CFuncInteractionLayerClipRaw extends CBaseModelEntityRaw {
        /** CFuncInteractionLayerClip/m_bDisabled */
        disabled: boolean;
        /** CFuncInteractionLayerClip/m_iszInteractsAs — Read-only, as every string field is. */
        readonly interactsAs: string;
        /** CFuncInteractionLayerClip/m_iszInteractsWith — Read-only, as every string field is. */
        readonly interactsWith: string;
    }

    /** The fields a CFuncLadder adds to CBaseModelEntityRaw. */
    interface CFuncLadderRaw extends CBaseModelEntityRaw {
        /** CFuncLadder/m_flAutoRideSpeed */
        autoRideSpeed: number;
        /** CFuncLadder/m_bDisabled */
        disabled: boolean;
        /** CFuncLadder/m_bFakeLadder */
        fakeLadder: boolean;
        /** CFuncLadder/m_bHasSlack */
        hasSlack: boolean;
        /** CFuncLadder/m_surfacePropName — Read-only, as every string field is. */
        readonly surfacePropName: string;
    }

    /** The fields a CFuncMover adds to CBaseModelEntityRaw. */
    interface CFuncMoverRaw extends CBaseModelEntityRaw {
        /** CFuncMover/m_bAllowMovableNavMeshDockingOnEntireEntity */
        allowMovableNavMeshDockingOnEntireEntity: boolean;
        /** CFuncMover/m_iszArriveAtDestinationSound — Read-only, as every string field is. */
        readonly arriveAtDestinationSound: string;
        /** CFuncMover/m_flBeginStopT */
        beginStopT: number;
        /** CFuncMover/m_flComputedDistanceToReachMaxSpeed */
        computedDistanceToReachMaxSpeed: number;
        /** CFuncMover/m_flComputedDistanceToReachZeroSpeed */
        computedDistanceToReachZeroSpeed: number;
        /** CFuncMover/m_bCreateMovableNavMesh */
        createMovableNavMesh: boolean;
        /** CFuncMover/m_bCreateMovableSurfaceGraph */
        createMovableSurfaceGraph: boolean;
        /** CFuncMover/m_flCurFollowEntityT */
        curFollowEntityT: number;
        /** CFuncMover/m_flCurFollowSpeed */
        curFollowSpeed: number;
        /** CFuncMover/m_nCurrentNodeIndex */
        currentNodeIndex: number;
        /** CFuncMover/m_nDelayedTeleportToNode */
        delayedTeleportToNode: number;
        /** CFuncMover/m_flDistanceToReachMaxSpeed */
        distanceToReachMaxSpeed: number;
        /** CFuncMover/m_flDistanceToReachZeroSpeed */
        distanceToReachZeroSpeed: number;
        /** CFuncMover/m_flDurationBlendToNewOrientationRan */
        durationBlendToNewOrientationRan: number;
        /** CFuncMover/m_eFollowConstraint — A CFuncMoverFollowConstraint_t. */
        followConstraint: number;
        /** CFuncMover/m_bFollowConstraintsInitialized */
        followConstraintsInitialized: boolean;
        /** CFuncMover/m_flFollowDistance */
        followDistance: number;
        /** CFuncMover/m_hFollowEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly followEntity: Entity<EntityRaw> | null;
        /** CFuncMover/m_eFollowEntityDirection — A CFuncMoverFollowEntityDirection_t. */
        followEntityDirection: number;
        /** CFuncMover/m_iszFollowEntityName — Read-only, as every string field is. */
        readonly followEntityName: string;
        /** CFuncMover/m_flFollowMinimumSpeed */
        followMinimumSpeed: number;
        /** CFuncMover/m_hFollowMover — Another entity, or null when it points at nothing. Read-only. */
        readonly followMover: Entity<EntityRaw> | null;
        /** CFuncMover/m_flFollowMoverCalculatedDistance */
        followMoverCalculatedDistance: number;
        /** CFuncMover/m_nFollowMoverConstraintPriority */
        followMoverConstraintPriority: number;
        /** CFuncMover/m_flFollowMoverDistance */
        followMoverDistance: number;
        /** CFuncMover/m_iszFollowMoverEntityName — Read-only, as every string field is. */
        readonly followMoverEntityName: string;
        /** CFuncMover/m_flFollowMoverRatio */
        followMoverRatio: number;
        /** CFuncMover/m_flFollowMoverSpeed */
        followMoverSpeed: number;
        /** CFuncMover/m_flFollowMoverSpringStrength */
        followMoverSpringStrength: number;
        /** CFuncMover/m_flFollowMoverVelocity */
        followMoverVelocity: number;
        /** CFuncMover/m_bIgnoreEndNode */
        ignoreEndNode: boolean;
        /** CFuncMover/m_bIsImGuiEntTextLogging */
        isImGuiEntTextLogging: boolean;
        /** CFuncMover/m_bIsImGuiLogging */
        isImGuiLogging: boolean;
        /** CFuncMover/m_bIsMoving */
        isMoving: boolean;
        /** CFuncMover/m_bIsPaused */
        isPaused: boolean;
        /** CFuncMover/m_bIsReversing */
        isReversing: boolean;
        /** CFuncMover/m_flLerpToPositionDeltaT */
        lerpToPositionDeltaT: number;
        /** CFuncMover/m_flLerpToPositionT */
        lerpToPositionT: number;
        /** CFuncMover/m_iszLoopForwardSound — Read-only, as every string field is. */
        readonly loopForwardSound: string;
        /** CFuncMover/m_iszLoopReverseSound — Read-only, as every string field is. */
        readonly loopReverseSound: string;
        /** CFuncMover/m_eMoveType — A CFuncMoverMove_t. */
        moveType: number;
        /** CFuncMover/m_bNextNodeReturnsCurrent */
        nextNodeReturnsCurrent: boolean;
        /** CFuncMover/m_hOrientationFaceEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly orientationFaceEntity: Entity<EntityRaw> | null;
        /** CFuncMover/m_hOrientationMatchEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly orientationMatchEntity: Entity<EntityRaw> | null;
        /** CFuncMover/m_iszOrientationMatchEntityName — Read-only, as every string field is. */
        readonly orientationMatchEntityName: string;
        /** CFuncMover/m_eOrientationUpdate — A CFuncMoverOrientationUpdate_t. */
        orientationUpdate: number;
        /** CFuncMover/m_flPathLocation */
        pathLocation: number;
        /** CFuncMover/m_flPathLocationStart */
        pathLocationStart: number;
        /** CFuncMover/m_flPathLocationToBeginStop */
        pathLocationToBeginStop: number;
        /** CFuncMover/m_hPathMover — Another entity, or null when it points at nothing. Read-only. */
        readonly pathMover: Entity<EntityRaw> | null;
        /** CFuncMover/m_iszPathName — Read-only, as every string field is. */
        readonly pathName: string;
        /** CFuncMover/m_iszPathNodeEnd — Read-only, as every string field is. */
        readonly pathNodeEnd: string;
        /** CFuncMover/m_iszPathNodeStart — Read-only, as every string field is. */
        readonly pathNodeStart: string;
        /** CFuncMover/m_ePathRebuildStrategy — A CFuncMoverPathRebuildStrategy_t. */
        pathRebuildStrategy: number;
        /** CFuncMover/m_hPrevPathMover — Another entity, or null when it points at nothing. Read-only. */
        readonly prevPathMover: Entity<EntityRaw> | null;
        /** CFuncMover/m_nPreviousNodeIndex */
        previousNodeIndex: number;
        /** CFuncMover/m_bQueueSetupPathMover */
        queueSetupPathMover: boolean;
        /** CFuncMover/m_bQueueStop */
        queueStop: boolean;
        /** CFuncMover/m_bQueueStopMoving */
        queueStopMoving: boolean;
        /** CFuncMover/m_eSolidType — A SolidType_t. */
        solidType: number;
        /** CFuncMover/m_flSpeed */
        speed: number;
        /** CFuncMover/m_bStartAtClosestPoint */
        startAtClosestPoint: boolean;
        /** CFuncMover/m_bStartAtEnd */
        startAtEnd: boolean;
        /** CFuncMover/m_flStartCurveScale */
        startCurveScale: number;
        /** CFuncMover/m_bStartFollowingClosestMover */
        startFollowingClosestMover: boolean;
        /** CFuncMover/m_iszStartForwardSound — Read-only, as every string field is. */
        readonly startForwardSound: string;
        /** CFuncMover/m_iszStartReverseSound — Read-only, as every string field is. */
        readonly startReverseSound: string;
        /** CFuncMover/m_flStartSpeed */
        startSpeed: number;
        /** CFuncMover/m_bStartedMoving */
        startedMoving: boolean;
        /** CFuncMover/m_hStopAtNode — Another entity, or null when it points at nothing. Read-only. */
        readonly stopAtNode: Entity<EntityRaw> | null;
        /** CFuncMover/m_flStopCurveScale */
        stopCurveScale: number;
        /** CFuncMover/m_iszStopForwardSound — Read-only, as every string field is. */
        readonly stopForwardSound: string;
        /** CFuncMover/m_bStopFromBeginStopTarget */
        stopFromBeginStopTarget: boolean;
        /** CFuncMover/m_iszStopReverseSound — Read-only, as every string field is. */
        readonly stopReverseSound: string;
        /** CFuncMover/m_strOrientationFaceEntityName — Read-only, as every string field is. */
        readonly strOrientationFaceEntityName: string;
        /** CFuncMover/m_flT */
        t: number;
        /** CFuncMover/m_nTickMovementRan */
        tickMovementRan: number;
        /** CFuncMover/m_flTimeMovementStart */
        timeMovementStart: number;
        /** CFuncMover/m_flTimeMovementStop */
        timeMovementStop: number;
        /** CFuncMover/m_flTimeStartOrientationChange */
        timeStartOrientationChange: number;
        /** CFuncMover/m_flTimeToBlendToNewOrientation */
        timeToBlendToNewOrientation: number;
        /** CFuncMover/m_flTimeToReachMaxSpeed */
        timeToReachMaxSpeed: number;
        /** CFuncMover/m_flTimeToReachZeroSpeed */
        timeToReachZeroSpeed: number;
        /** CFuncMover/m_flTimeToTraverseToNextNode */
        timeToTraverseToNextNode: number;
        /** CFuncMover/m_eTransitionedToPathNodeAction — A CFuncMoverTransitionToPathNodeAction_t. */
        transitionedToPathNodeAction: number;
    }

    /** The fields a CFuncNavBlocker adds to CBaseModelEntityRaw. */
    interface CFuncNavBlockerRaw extends CBaseModelEntityRaw {
        /** CFuncNavBlocker/m_nBlockedTeamNumber */
        blockedTeamNumber: number;
        /** CFuncNavBlocker/m_bDisabled */
        disabled: boolean;
    }

    /** The fields a CFuncNavObstruction adds to CBaseModelEntityRaw. */
    interface CFuncNavObstructionRaw extends CBaseModelEntityRaw {
        /** CFuncNavObstruction/m_bDisabled */
        disabled: boolean;
        /** CFuncNavObstruction/m_bUseAsyncObstacleUpdate */
        useAsyncObstacleUpdate: boolean;
    }

    /** The fields a CFuncRotating adds to CBaseModelEntityRaw. */
    interface CFuncRotatingRaw extends CBaseModelEntityRaw {
        /** CFuncRotating/m_bAccelDecel */
        accelDecel: boolean;
        /** CFuncRotating/m_flAttenuation */
        attenuation: number;
        /** CFuncRotating/m_flBlockDamage */
        blockDamage: number;
        /** CFuncRotating/m_flFanFriction */
        fanFriction: number;
        /** CFuncRotating/m_flMaxSpeed */
        maxSpeed: number;
        /** CFuncRotating/m_NoiseRunning — Read-only, as every string field is. */
        readonly noiseRunning: string;
        /** CFuncRotating/m_bReversed */
        reversed: boolean;
        /** CFuncRotating/m_flSpeed */
        speed: number;
        /** CFuncRotating/m_bStopAtStartPos */
        stopAtStartPos: boolean;
        /** CFuncRotating/m_flTargetSpeed */
        targetSpeed: number;
        /** CFuncRotating/m_flVolume */
        volume: number;
    }

    /** The fields a CFuncRotator adds to CBaseModelEntityRaw. */
    interface CFuncRotatorRaw extends CBaseModelEntityRaw {
        /** CFuncRotator/m_flCurrentAngle */
        currentAngle: number;
        /** CFuncRotator/m_bIsRotating */
        isRotating: boolean;
        /** CFuncRotator/m_iszLoopSound — Read-only, as every string field is. */
        readonly loopSound: string;
        /** CFuncRotator/m_flMaxYawRotation */
        maxYawRotation: number;
        /** CFuncRotator/m_flMinYawRotation */
        minYawRotation: number;
        /** CFuncRotator/m_nOscillationCount */
        oscillationCount: number;
        /** CFuncRotator/m_bOscillationFromStart */
        oscillationFromStart: boolean;
        /** CFuncRotator/m_bRecordHistory */
        recordHistory: boolean;
        /** CFuncRotator/m_bReturningToInitialRotation */
        returningToInitialRotation: boolean;
        /** CFuncRotator/m_bReturningToPreviousRotation */
        returningToPreviousRotation: boolean;
        /** CFuncRotator/m_eRotateType — A CFuncRotatorRotate_t. */
        rotateType: number;
        /** CFuncRotator/m_eRotationAxis — A CFuncRotatorRotationAxis_t. */
        rotationAxis: number;
        /** CFuncRotator/m_hRotatorTarget — Another entity, or null when it points at nothing. Read-only. */
        readonly rotatorTarget: Entity<EntityRaw> | null;
        /** CFuncRotator/m_eSolidType — A SolidType_t. */
        solidType: number;
        /** CFuncRotator/m_flSpeed */
        speed: number;
        /** CFuncRotator/m_flSpeedDriftFromOverRotate */
        speedDriftFromOverRotate: number;
        /** CFuncRotator/m_iszStartSound — Read-only, as every string field is. */
        readonly startSound: string;
        /** CFuncRotator/m_flStartSpeed */
        startSpeed: number;
        /** CFuncRotator/m_bStartedRotating */
        startedRotating: boolean;
        /** CFuncRotator/m_iszStopSound — Read-only, as every string field is. */
        readonly stopSound: string;
        /** CFuncRotator/m_strRotatorTarget — Read-only, as every string field is. */
        readonly strRotatorTarget: string;
        /** CFuncRotator/m_flTargetAngle */
        targetAngle: number;
        /** CFuncRotator/m_nTickRotateRan */
        tickRotateRan: number;
        /** CFuncRotator/m_flTimeRotationStart */
        timeRotationStart: number;
        /** CFuncRotator/m_flTimeRotationStop */
        timeRotationStop: number;
        /** CFuncRotator/m_flTimeToCompleteRotation */
        timeToCompleteRotation: number;
        /** CFuncRotator/m_flTimeToReachMaxSpeed */
        timeToReachMaxSpeed: number;
        /** CFuncRotator/m_flTimeToReachZeroSpeed */
        timeToReachZeroSpeed: number;
    }

    /** The fields a CFuncShatterglass adds to CBaseModelEntityRaw. */
    interface CFuncShatterglassRaw extends CBaseModelEntityRaw {
        /** CFuncShatterglass/m_bBreakShardless */
        breakShardless: boolean;
        /** CFuncShatterglass/m_bBreakSilent */
        breakSilent: boolean;
        /** CFuncShatterglass/m_bBroken */
        broken: boolean;
        /** CFuncShatterglass/m_szDamagePositioningEntityName01 — Read-only, as every string field is. */
        readonly damagePositioningEntityName01: string;
        /** CFuncShatterglass/m_szDamagePositioningEntityName02 — Read-only, as every string field is. */
        readonly damagePositioningEntityName02: string;
        /** CFuncShatterglass/m_szDamagePositioningEntityName03 — Read-only, as every string field is. */
        readonly damagePositioningEntityName03: string;
        /** CFuncShatterglass/m_szDamagePositioningEntityName04 — Read-only, as every string field is. */
        readonly damagePositioningEntityName04: string;
        /** CFuncShatterglass/m_bGlassInFrame */
        glassInFrame: boolean;
        /** CFuncShatterglass/m_bGlassNavIgnore */
        glassNavIgnore: boolean;
        /** CFuncShatterglass/m_flGlassThickness */
        glassThickness: number;
        /** CFuncShatterglass/m_flInitAtTime */
        initAtTime: number;
        /** CFuncShatterglass/m_iInitialDamageType */
        initialDamageType: number;
        /** CFuncShatterglass/m_flLastCleanupTime */
        lastCleanupTime: number;
        /** CFuncShatterglass/m_flLastShatterSoundEmitTime */
        lastShatterSoundEmitTime: number;
        /** CFuncShatterglass/m_flSpawnInvulnerability */
        spawnInvulnerability: number;
        /** CFuncShatterglass/m_bStartBroken */
        startBroken: boolean;
        /** CFuncShatterglass/m_iSurfaceType */
        surfaceType: number;
    }

    /** The fields a CFuncTrackTrain adds to CBaseModelEntityRaw. */
    interface CFuncTrackTrainRaw extends CBaseModelEntityRaw {
        /** CFuncTrackTrain/m_flAccelSpeed */
        accelSpeed: number;
        /** CFuncTrackTrain/m_bAccelToSpeed */
        accelToSpeed: boolean;
        /** CFuncTrackTrain/m_flBank */
        bank: number;
        /** CFuncTrackTrain/m_flBlockDamage */
        blockDamage: number;
        /** CFuncTrackTrain/m_flDecelSpeed */
        decelSpeed: number;
        /** CFuncTrackTrain/m_flDesiredSpeed */
        desiredSpeed: number;
        /** CFuncTrackTrain/m_dir */
        dir: number;
        /** CFuncTrackTrain/m_height */
        height: number;
        /** CFuncTrackTrain/m_lastBlockTick */
        lastBlockTick: number;
        /** CFuncTrackTrain/m_length */
        length: number;
        /** CFuncTrackTrain/m_bManualSpeedChanges */
        manualSpeedChanges: boolean;
        /** CFuncTrackTrain/m_maxSpeed */
        maxSpeed: number;
        /** CFuncTrackTrain/m_flMoveSoundMaxDuration */
        moveSoundMaxDuration: number;
        /** CFuncTrackTrain/m_flMoveSoundMaxPitch */
        moveSoundMaxPitch: number;
        /** CFuncTrackTrain/m_flMoveSoundMinDuration */
        moveSoundMinDuration: number;
        /** CFuncTrackTrain/m_flMoveSoundMinPitch */
        moveSoundMinPitch: number;
        /** CFuncTrackTrain/m_flNextMPSoundTime */
        nextMPSoundTime: number;
        /** CFuncTrackTrain/m_flNextMoveSoundTime */
        nextMoveSoundTime: number;
        /** CFuncTrackTrain/m_oldSpeed */
        oldSpeed: number;
        /** CFuncTrackTrain/m_eOrientationType — A TrainOrientationType_t. */
        orientationType: number;
        /** CFuncTrackTrain/m_ppath — Another entity, or null when it points at nothing. Read-only. */
        readonly ppath: Entity<EntityRaw> | null;
        /** CFuncTrackTrain/m_iszSoundMove — Read-only, as every string field is. */
        readonly soundMove: string;
        /** CFuncTrackTrain/m_iszSoundMovePing — Read-only, as every string field is. */
        readonly soundMovePing: string;
        /** CFuncTrackTrain/m_iszSoundStart — Read-only, as every string field is. */
        readonly soundStart: string;
        /** CFuncTrackTrain/m_iszSoundStop — Read-only, as every string field is. */
        readonly soundStop: string;
        /** CFuncTrackTrain/m_flSpeed */
        speed: number;
        /** CFuncTrackTrain/m_flSpeedChangeTime */
        speedChangeTime: number;
        /** CFuncTrackTrain/m_strPathTarget — Read-only, as every string field is. */
        readonly strPathTarget: string;
        /** CFuncTrackTrain/m_eVelocityType — A TrainVelocityType_t. */
        velocityType: number;
        /** CFuncTrackTrain/m_flVolume */
        volume: number;
    }

    /** The fields a CFuncTrainControls adds to CBaseModelEntityRaw. */
    interface CFuncTrainControlsRaw extends CBaseModelEntityRaw {
    }

    /** The fields a CFuncVPhysicsClip adds to CBaseModelEntityRaw. */
    interface CFuncVPhysicsClipRaw extends CBaseModelEntityRaw {
        /** CFuncVPhysicsClip/m_bDisabled */
        disabled: boolean;
    }

    /** The fields a CFuncVehicleClip adds to CBaseModelEntityRaw. */
    interface CFuncVehicleClipRaw extends CBaseModelEntityRaw {
    }

    /** The fields a CFuncWall adds to CBaseModelEntityRaw. */
    interface CFuncWallRaw extends CBaseModelEntityRaw {
        /** CFuncWall/m_nState */
        state: number;
    }

    /** The fields a CFuncWater adds to CBaseModelEntityRaw. */
    interface CFuncWaterRaw extends CBaseModelEntityRaw {
    }

    /** The fields a CInferno adds to CBaseModelEntityRaw. */
    interface CInfernoRaw extends CBaseModelEntityRaw {
        /** CInferno/m_fireCount */
        fireCount: number;
        /** CInferno/m_nFireEffectTickBegin */
        fireEffectTickBegin: number;
        /** CInferno/m_nFireLifetime */
        fireLifetime: number;
        /** CInferno/m_fireSpawnOffset */
        fireSpawnOffset: number;
        /** CInferno/m_bInPostEffectTime */
        inPostEffectTime: boolean;
        /** CInferno/m_nInfernoType */
        infernoType: number;
        /** CInferno/m_nMaxFlames */
        maxFlames: number;
        /** CInferno/m_nSourceItemDefIndex */
        sourceItemDefIndex: number;
        /** CInferno/m_nSpreadCount */
        spreadCount: number;
        /** CInferno/m_bWasCreatedInSmoke */
        wasCreatedInSmoke: boolean;
    }

    /** The fields a CInfoChoreoAnchor adds to CPointEntityRaw. */
    interface CInfoChoreoAnchorRaw extends CPointEntityRaw {
    }

    /** The fields a CInfoData adds to CServerOnlyEntityRaw. */
    interface CInfoDataRaw extends CServerOnlyEntityRaw {
    }

    /** The fields a CInfoDynamicShadowHint adds to CPointEntityRaw. */
    interface CInfoDynamicShadowHintRaw extends CPointEntityRaw {
        /** CInfoDynamicShadowHint/m_bDisabled */
        disabled: boolean;
        /** CInfoDynamicShadowHint/m_nImportance */
        importance: number;
        /** CInfoDynamicShadowHint/m_hLight — Another entity, or null when it points at nothing. Read-only. */
        readonly light: Entity<EntityRaw> | null;
        /** CInfoDynamicShadowHint/m_nLightChoice */
        lightChoice: number;
        /** CInfoDynamicShadowHint/m_flRange */
        range: number;
    }

    /** The fields a CInfoFan adds to CPointEntityRaw. */
    interface CInfoFanRaw extends CPointEntityRaw {
        /** CInfoFan/m_flCurveDistRange */
        curveDistRange: number;
        /** CInfoFan/m_FanForceCurveString — Read-only, as every string field is. */
        readonly fanForceCurveString: string;
        /** CInfoFan/m_fFanForceMaxRadius */
        fanForceMaxRadius: number;
        /** CInfoFan/m_fFanForceMinRadius */
        fanForceMinRadius: number;
    }

    /** The fields a CInfoGameEventProxy adds to CPointEntityRaw. */
    interface CInfoGameEventProxyRaw extends CPointEntityRaw {
        /** CInfoGameEventProxy/m_iszEventName — Read-only, as every string field is. */
        readonly eventName: string;
        /** CInfoGameEventProxy/m_flRange */
        range: number;
    }

    /** The fields a CInfoInstructorHintBombTargetA adds to CPointEntityRaw. */
    interface CInfoInstructorHintBombTargetARaw extends CPointEntityRaw {
    }

    /** The fields a CInfoInstructorHintBombTargetB adds to CPointEntityRaw. */
    interface CInfoInstructorHintBombTargetBRaw extends CPointEntityRaw {
    }

    /** The fields a CInfoInstructorHintHostageRescueZone adds to CPointEntityRaw. */
    interface CInfoInstructorHintHostageRescueZoneRaw extends CPointEntityRaw {
    }

    /** The fields a CInfoInstructorHintTarget adds to CPointEntityRaw. */
    interface CInfoInstructorHintTargetRaw extends CPointEntityRaw {
    }

    /** The fields a CInfoLandmark adds to CPointEntityRaw. */
    interface CInfoLandmarkRaw extends CPointEntityRaw {
    }

    /** The fields a CInfoOffscreenPanoramaTexture adds to CPointEntityRaw. */
    interface CInfoOffscreenPanoramaTextureRaw extends CPointEntityRaw {
        /** CInfoOffscreenPanoramaTexture/m_bDisabled */
        disabled: boolean;
        /** CInfoOffscreenPanoramaTexture/m_szLayoutFileName — Read-only, as every string field is. */
        readonly layoutFileName: string;
        /** CInfoOffscreenPanoramaTexture/m_szPanelType — Read-only, as every string field is. */
        readonly panelType: string;
        /** CInfoOffscreenPanoramaTexture/m_RenderAttrName — Read-only, as every string field is. */
        readonly renderAttrName: string;
        /** CInfoOffscreenPanoramaTexture/m_nResolutionX */
        resolutionX: number;
        /** CInfoOffscreenPanoramaTexture/m_nResolutionY */
        resolutionY: number;
        /** CInfoOffscreenPanoramaTexture/m_nTargetChangeCount */
        targetChangeCount: number;
        /** CInfoOffscreenPanoramaTexture/m_szTargetsName — Read-only, as every string field is. */
        readonly targetsName: string;
    }

    /** The fields a CInfoParticleTarget adds to CPointEntityRaw. */
    interface CInfoParticleTargetRaw extends CPointEntityRaw {
    }

    /** The fields a CInfoPlayerStart adds to CPointEntityRaw. */
    interface CInfoPlayerStartRaw extends CPointEntityRaw {
        /** CInfoPlayerStart/m_bDisabled */
        disabled: boolean;
        /** CInfoPlayerStart/m_bIsMaster */
        isMaster: boolean;
        /** CInfoPlayerStart/m_pPawnSubclass — Read-only, as every string field is. */
        readonly pawnSubclass: string;
    }

    /** The fields a CInfoSpawnGroupLandmark adds to CPointEntityRaw. */
    interface CInfoSpawnGroupLandmarkRaw extends CPointEntityRaw {
    }

    /** The fields a CInfoTarget adds to CPointEntityRaw. */
    interface CInfoTargetRaw extends CPointEntityRaw {
    }

    /** The fields a CInfoTeleportDestination adds to CPointEntityRaw. */
    interface CInfoTeleportDestinationRaw extends CPointEntityRaw {
    }

    /** The fields a CInstructorEventEntity adds to CPointEntityRaw. */
    interface CInstructorEventEntityRaw extends CPointEntityRaw {
        /** CInstructorEventEntity/m_iszHintTargetEntity — Read-only, as every string field is. */
        readonly hintTargetEntity: string;
        /** CInstructorEventEntity/m_iszName — Read-only, as every string field is. */
        readonly name: string;
        /** CInstructorEventEntity/m_hTargetPlayer — Another entity, or null when it points at nothing. Read-only. */
        readonly targetPlayer: Entity<EntityRaw> | null;
    }

    /** The fields a CItemGenericTriggerHelper adds to CBaseModelEntityRaw. */
    interface CItemGenericTriggerHelperRaw extends CBaseModelEntityRaw {
        /** CItemGenericTriggerHelper/m_hParentItem — Another entity, or null when it points at nothing. Read-only. */
        readonly parentItem: Entity<EntityRaw> | null;
    }

    /** The fields a CKeepUpright adds to CPointEntityRaw. */
    interface CKeepUprightRaw extends CPointEntityRaw {
        /** CKeepUpright/m_bActive */
        active: boolean;
        /** CKeepUpright/m_angularLimit */
        angularLimit: number;
        /** CKeepUpright/m_attachedObject — Another entity, or null when it points at nothing. Read-only. */
        readonly attachedObject: Entity<EntityRaw> | null;
        /** CKeepUpright/m_bDampAllRotation */
        dampAllRotation: boolean;
        /** CKeepUpright/m_nameAttach — Read-only, as every string field is. */
        readonly nameAttach: string;
    }

    /** The fields a CLightEntity adds to CBaseModelEntityRaw. */
    interface CLightEntityRaw extends CBaseModelEntityRaw {
    }

    /** The fields a CLogicNPCCounterAABB adds to CLogicNPCCounterRaw. */
    interface CLogicNPCCounterAABBRaw extends CLogicNPCCounterRaw {
    }

    /** The fields a CLogicProximity adds to CPointEntityRaw. */
    interface CLogicProximityRaw extends CPointEntityRaw {
    }

    /** The fields a CLogicScript adds to CPointEntityRaw. */
    interface CLogicScriptRaw extends CPointEntityRaw {
    }

    /** The fields a CLogicalEntity adds to CServerOnlyEntityRaw. */
    interface CLogicalEntityRaw extends CServerOnlyEntityRaw {
    }

    /** The fields a CMapInfo adds to CPointEntityRaw. */
    interface CMapInfoRaw extends CPointEntityRaw {
        /** CMapInfo/m_flBombRadius */
        bombRadius: number;
        /** CMapInfo/m_flBotMaxVisionDistance */
        botMaxVisionDistance: number;
        /** CMapInfo/m_iBuyingStatus */
        buyingStatus: number;
        /** CMapInfo/m_bDisableAutoGeneratedDMSpawns */
        disableAutoGeneratedDMSpawns: boolean;
        /** CMapInfo/m_flEnvPuddleRippleDirection */
        envPuddleRippleDirection: number;
        /** CMapInfo/m_flEnvPuddleRippleStrength */
        envPuddleRippleStrength: number;
        /** CMapInfo/m_flEnvRainStrength */
        envRainStrength: number;
        /** CMapInfo/m_flEnvWetnessCoverage */
        envWetnessCoverage: number;
        /** CMapInfo/m_flEnvWetnessDryingAmount */
        envWetnessDryingAmount: number;
        /** CMapInfo/m_bFadePlayerVisibilityFarZ */
        fadePlayerVisibilityFarZ: boolean;
        /** CMapInfo/m_bGPUCullSkybox */
        gPUCullSkybox: boolean;
        /** CMapInfo/m_iHostageCount */
        hostageCount: number;
        /** CMapInfo/m_iPetPopulation */
        petPopulation: number;
        /** CMapInfo/m_bRainTraceToSkyEnabled */
        rainTraceToSkyEnabled: boolean;
        /** CMapInfo/m_bUseNormalSpawnsForDM */
        useNormalSpawnsForDM: boolean;
    }

    /** The fields a CMarkupVolume adds to CBaseModelEntityRaw. */
    interface CMarkupVolumeRaw extends CBaseModelEntityRaw {
        /** CMarkupVolume/m_bDisabled */
        disabled: boolean;
    }

    /** The fields a CMessage adds to CPointEntityRaw. */
    interface CMessageRaw extends CPointEntityRaw {
        /** CMessage/m_iszMessage — Read-only, as every string field is. */
        readonly message: string;
        /** CMessage/m_MessageAttenuation */
        messageAttenuation: number;
        /** CMessage/m_MessageVolume */
        messageVolume: number;
        /** CMessage/m_sNoise — Read-only, as every string field is. */
        readonly noise: string;
        /** CMessage/m_Radius */
        radius: number;
    }

    /** The fields a CMessageEntity adds to CPointEntityRaw. */
    interface CMessageEntityRaw extends CPointEntityRaw {
        /** CMessageEntity/m_bDeveloperOnly */
        developerOnly: boolean;
        /** CMessageEntity/m_drawText */
        drawText: boolean;
        /** CMessageEntity/m_bEnabled */
        enabled: boolean;
        /** CMessageEntity/m_messageText — Read-only, as every string field is. */
        readonly messageText: string;
        /** CMessageEntity/m_radius */
        radius: number;
    }

    /** The fields a CModelPointEntity adds to CBaseModelEntityRaw. */
    interface CModelPointEntityRaw extends CBaseModelEntityRaw {
    }

    /** The fields a CNavSpaceInfo adds to CPointEntityRaw. */
    interface CNavSpaceInfoRaw extends CPointEntityRaw {
    }

    /** The fields a CNavWalkable adds to CPointEntityRaw. */
    interface CNavWalkableRaw extends CPointEntityRaw {
    }

    /** The fields a CParticleSystem adds to CBaseModelEntityRaw. */
    interface CParticleSystemRaw extends CBaseModelEntityRaw {
        /** CParticleSystem/m_bActive */
        active: boolean;
        /** CParticleSystem/m_bAnimateDuringGameplayPause */
        animateDuringGameplayPause: boolean;
        /** CParticleSystem/m_nDataCP */
        dataCP: number;
        /** CParticleSystem/m_bDataStringLocalized */
        dataStringLocalized: boolean;
        /** CParticleSystem/m_iszEffectName — Read-only, as every string field is. */
        readonly effectName: string;
        /** CParticleSystem/m_flFreezeTransitionDuration */
        freezeTransitionDuration: number;
        /** CParticleSystem/m_bFrozen */
        frozen: boolean;
        /** CParticleSystem/m_bNoFreeze */
        noFreeze: boolean;
        /** CParticleSystem/m_bNoRamp */
        noRamp: boolean;
        /** CParticleSystem/m_bNoSave */
        noSave: boolean;
        /** CParticleSystem/m_flPreSimTime */
        preSimTime: number;
        /** CParticleSystem/m_szSnapshotFileName — Read-only, as every string field is. */
        readonly snapshotFileName: string;
        /** CParticleSystem/m_bStartActive */
        startActive: boolean;
        /** CParticleSystem/m_flStartTime */
        startTime: number;
        /** CParticleSystem/m_nStopType */
        stopType: number;
        /** CParticleSystem/m_strDataString — Read-only, as every string field is. */
        readonly strDataString: string;
        /** CParticleSystem/m_nTintCP */
        tintCP: number;
    }

    /** The fields a CPathCorner adds to CPointEntityRaw. */
    interface CPathCornerRaw extends CPointEntityRaw {
        /** CPathCorner/m_flRadius */
        radius: number;
        /** CPathCorner/m_flSpeed */
        speed: number;
        /** CPathCorner/m_flWait */
        wait: number;
    }

    /** The fields a CPathNode adds to CPointEntityRaw. */
    interface CPathNodeRaw extends CPointEntityRaw {
        /** CPathNode/m_hPath — Another entity, or null when it points at nothing. Read-only. */
        readonly path: Entity<EntityRaw> | null;
        /** CPathNode/m_strParentPathUniqueID — Read-only, as every string field is. */
        readonly strParentPathUniqueID: string;
        /** CPathNode/m_strPathNodeParameter — Read-only, as every string field is. */
        readonly strPathNodeParameter: string;
    }

    /** The fields a CPathParticleRopeAlias_path_particle_rope_clientside adds to CPathParticleRopeRaw. */
    interface CPathParticleRopeAlias_path_particle_rope_clientsideRaw extends CPathParticleRopeRaw {
    }

    /** The fields a CPathTrack adds to CPointEntityRaw. */
    interface CPathTrackRaw extends CPointEntityRaw {
        /** CPathTrack/m_altName — Read-only, as every string field is. */
        readonly altName: string;
        /** CPathTrack/m_nIterVal */
        iterVal: number;
        /** CPathTrack/m_length */
        length: number;
        /** CPathTrack/m_eOrientationType — A TrackOrientationType_t. */
        orientationType: number;
        /** CPathTrack/m_paltpath — Another entity, or null when it points at nothing. Read-only. */
        readonly paltpath: Entity<EntityRaw> | null;
        /** CPathTrack/m_pnext — Another entity, or null when it points at nothing. Read-only. */
        readonly pnext: Entity<EntityRaw> | null;
        /** CPathTrack/m_pprevious — Another entity, or null when it points at nothing. Read-only. */
        readonly pprevious: Entity<EntityRaw> | null;
        /** CPathTrack/m_flRadius */
        radius: number;
        /** CPathTrack/m_flSpeed */
        speed: number;
    }

    /** The fields a CPathWithDynamicNodes adds to CPathSimpleRaw. */
    interface CPathWithDynamicNodesRaw extends CPathSimpleRaw {
    }

    /** The fields a CPhysExplosion adds to CPointEntityRaw. */
    interface CPhysExplosionRaw extends CPointEntityRaw {
        /** CPhysExplosion/m_bAffectInvulnerableEnts */
        affectInvulnerableEnts: boolean;
        /** CPhysExplosion/m_bConvertToDebrisWhenPossible */
        convertToDebrisWhenPossible: boolean;
        /** CPhysExplosion/m_flDamage */
        damage: number;
        /** CPhysExplosion/m_bDisablePushClamp */
        disablePushClamp: boolean;
        /** CPhysExplosion/m_bExplodeOnSpawn */
        explodeOnSpawn: boolean;
        /** CPhysExplosion/m_flInnerRadius */
        innerRadius: number;
        /** CPhysExplosion/m_flMagnitude */
        magnitude: number;
        /** CPhysExplosion/m_flPushScale */
        pushScale: number;
        /** CPhysExplosion/m_radius */
        radius: number;
        /** CPhysExplosion/m_targetEntityName — Read-only, as every string field is. */
        readonly targetEntityName: string;
    }

    /** The fields a CPhysForce adds to CPointEntityRaw. */
    interface CPhysForceRaw extends CPointEntityRaw {
        /** CPhysForce/m_attachedObject — Another entity, or null when it points at nothing. Read-only. */
        readonly attachedObject: Entity<EntityRaw> | null;
        /** CPhysForce/m_force */
        force: number;
        /** CPhysForce/m_forceTime */
        forceTime: number;
        /** CPhysForce/m_nameAttach — Read-only, as every string field is. */
        readonly nameAttach: string;
        /** CPhysForce/m_wasRestored */
        wasRestored: boolean;
    }

    /** The fields a CPhysImpact adds to CPointEntityRaw. */
    interface CPhysImpactRaw extends CPointEntityRaw {
        /** CPhysImpact/m_damage */
        damage: number;
        /** CPhysImpact/m_directionEntityName — Read-only, as every string field is. */
        readonly directionEntityName: string;
        /** CPhysImpact/m_distance */
        distance: number;
    }

    /** The fields a CPlatTrigger adds to CBaseModelEntityRaw. */
    interface CPlatTriggerRaw extends CBaseModelEntityRaw {
        /** CPlatTrigger/m_pPlatform — Another entity, or null when it points at nothing. Read-only. */
        readonly platform: Entity<EntityRaw> | null;
    }

    /** The fields a CPointAngleSensor adds to CPointEntityRaw. */
    interface CPointAngleSensorRaw extends CPointEntityRaw {
        /** CPointAngleSensor/m_bDisabled */
        disabled: boolean;
        /** CPointAngleSensor/m_flDotTolerance */
        dotTolerance: number;
        /** CPointAngleSensor/m_flDuration */
        duration: number;
        /** CPointAngleSensor/m_flFacingTime */
        facingTime: number;
        /** CPointAngleSensor/m_bFired */
        fired: boolean;
        /** CPointAngleSensor/m_hLookAtEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly lookAtEntity: Entity<EntityRaw> | null;
        /** CPointAngleSensor/m_nLookAtName — Read-only, as every string field is. */
        readonly lookAtName: string;
        /** CPointAngleSensor/m_hTargetEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly targetEntity: Entity<EntityRaw> | null;
    }

    /** The fields a CPointAngularVelocitySensor adds to CPointEntityRaw. */
    interface CPointAngularVelocitySensorRaw extends CPointEntityRaw {
        /** CPointAngularVelocitySensor/m_flFireInterval */
        fireInterval: number;
        /** CPointAngularVelocitySensor/m_flFireTime */
        fireTime: number;
        /** CPointAngularVelocitySensor/m_flLastAngVelocity */
        lastAngVelocity: number;
        /** CPointAngularVelocitySensor/m_nLastCompareResult */
        lastCompareResult: number;
        /** CPointAngularVelocitySensor/m_nLastFireResult */
        lastFireResult: number;
        /** CPointAngularVelocitySensor/m_hTargetEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly targetEntity: Entity<EntityRaw> | null;
        /** CPointAngularVelocitySensor/m_flThreshold */
        threshold: number;
        /** CPointAngularVelocitySensor/m_bUseHelper */
        useHelper: boolean;
    }

    /** The fields a CPointBroadcastClientCommand adds to CPointEntityRaw. */
    interface CPointBroadcastClientCommandRaw extends CPointEntityRaw {
    }

    /** The fields a CPointCameraVFOV adds to CPointCameraRaw. */
    interface CPointCameraVFOVRaw extends CPointCameraRaw {
        /** CPointCameraVFOV/m_flVerticalFOV */
        verticalFOV: number;
    }

    /** The fields a CPointChildModifier adds to CPointEntityRaw. */
    interface CPointChildModifierRaw extends CPointEntityRaw {
        /** CPointChildModifier/m_bOrphanInsteadOfDeletingChildrenOnRemove */
        orphanInsteadOfDeletingChildrenOnRemove: boolean;
    }

    /** The fields a CPointClientCommand adds to CPointEntityRaw. */
    interface CPointClientCommandRaw extends CPointEntityRaw {
    }

    /** The fields a CPointGamestatsCounter adds to CPointEntityRaw. */
    interface CPointGamestatsCounterRaw extends CPointEntityRaw {
        /** CPointGamestatsCounter/m_bDisabled */
        disabled: boolean;
        /** CPointGamestatsCounter/m_strStatisticName — Read-only, as every string field is. */
        readonly strStatisticName: string;
    }

    /** The fields a CPointGiveAmmo adds to CPointEntityRaw. */
    interface CPointGiveAmmoRaw extends CPointEntityRaw {
        /** CPointGiveAmmo/m_pActivator — Another entity, or null when it points at nothing. Read-only. */
        readonly activator: Entity<EntityRaw> | null;
    }

    /** The fields a CPointHurt adds to CPointEntityRaw. */
    interface CPointHurtRaw extends CPointEntityRaw {
        /** CPointHurt/m_pActivator — Another entity, or null when it points at nothing. Read-only. */
        readonly activator: Entity<EntityRaw> | null;
        /** CPointHurt/m_bitsDamageType — A DamageTypes_t. */
        bitsDamageType: number;
        /** CPointHurt/m_nDamage */
        damage: number;
        /** CPointHurt/m_flDelay */
        delay: number;
        /** CPointHurt/m_flRadius */
        radius: number;
        /** CPointHurt/m_strTarget — Read-only, as every string field is. */
        readonly strTarget: string;
    }

    /** The fields a CPointProximitySensor adds to CPointEntityRaw. */
    interface CPointProximitySensorRaw extends CPointEntityRaw {
        /** CPointProximitySensor/m_bDisabled */
        disabled: boolean;
        /** CPointProximitySensor/m_hTargetEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly targetEntity: Entity<EntityRaw> | null;
    }

    /** The fields a CPointPush adds to CPointEntityRaw. */
    interface CPointPushRaw extends CPointEntityRaw {
        /** CPointPush/m_flConeOfInfluence */
        coneOfInfluence: number;
        /** CPointPush/m_bEnabled */
        enabled: boolean;
        /** CPointPush/m_hFilter — Another entity, or null when it points at nothing. Read-only. */
        readonly filter: Entity<EntityRaw> | null;
        /** CPointPush/m_iszFilterName — Read-only, as every string field is. */
        readonly filterName: string;
        /** CPointPush/m_flInnerRadius */
        innerRadius: number;
        /** CPointPush/m_flMagnitude */
        magnitude: number;
        /** CPointPush/m_flRadius */
        radius: number;
    }

    /** The fields a CPointServerCommand adds to CPointEntityRaw. */
    interface CPointServerCommandRaw extends CPointEntityRaw {
    }

    /** The fields a CPointVelocitySensor adds to CPointEntityRaw. */
    interface CPointVelocitySensorRaw extends CPointEntityRaw {
        /** CPointVelocitySensor/m_flAvgInterval */
        avgInterval: number;
        /** CPointVelocitySensor/m_bEnabled */
        enabled: boolean;
        /** CPointVelocitySensor/m_fPrevVelocity */
        prevVelocity: number;
        /** CPointVelocitySensor/m_hTargetEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly targetEntity: Entity<EntityRaw> | null;
    }

    /** The fields a CPrecipitationBlocker adds to CBaseModelEntityRaw. */
    interface CPrecipitationBlockerRaw extends CBaseModelEntityRaw {
    }

    /** The fields a CRagdollMagnet adds to CPointEntityRaw. */
    interface CRagdollMagnetRaw extends CPointEntityRaw {
        /** CRagdollMagnet/m_bDisabled */
        disabled: boolean;
        /** CRagdollMagnet/m_force */
        force: number;
        /** CRagdollMagnet/m_radius */
        radius: number;
    }

    /** The fields a CRopeKeyframe adds to CBaseModelEntityRaw. */
    interface CRopeKeyframeRaw extends CBaseModelEntityRaw {
        /** CRopeKeyframe/m_nChangeCount */
        changeCount: number;
        /** CRopeKeyframe/m_bConstrainBetweenEndpoints */
        constrainBetweenEndpoints: boolean;
        /** CRopeKeyframe/m_bCreatedFromMapFile */
        createdFromMapFile: boolean;
        /** CRopeKeyframe/m_hEndPoint — Another entity, or null when it points at nothing. Read-only. */
        readonly endPoint: Entity<EntityRaw> | null;
        /** CRopeKeyframe/m_bEndPointValid */
        endPointValid: boolean;
        /** CRopeKeyframe/m_fLockedPoints */
        lockedPoints: number;
        /** CRopeKeyframe/m_iNextLinkName — Read-only, as every string field is. */
        readonly nextLinkName: string;
        /** CRopeKeyframe/m_RopeFlags */
        ropeFlags: number;
        /** CRopeKeyframe/m_RopeLength */
        ropeLength: number;
        /** CRopeKeyframe/m_flScrollSpeed */
        scrollSpeed: number;
        /** CRopeKeyframe/m_nSegments */
        segments: number;
        /** CRopeKeyframe/m_Slack */
        slack: number;
        /** CRopeKeyframe/m_hStartPoint — Another entity, or null when it points at nothing. Read-only. */
        readonly startPoint: Entity<EntityRaw> | null;
        /** CRopeKeyframe/m_bStartPointValid */
        startPointValid: boolean;
        /** CRopeKeyframe/m_strRopeMaterialModel — Read-only, as every string field is. */
        readonly strRopeMaterialModel: string;
        /** CRopeKeyframe/m_Subdiv */
        subdiv: number;
        /** CRopeKeyframe/m_TextureScale */
        textureScale: number;
        /** CRopeKeyframe/m_Width */
        width: number;
    }

    /** The fields a CRotatorTarget adds to CPointEntityRaw. */
    interface CRotatorTargetRaw extends CPointEntityRaw {
        /** CRotatorTarget/m_eSpace — A RotatorTargetSpace_t. */
        space: number;
    }

    /** The fields a CRuleEntity adds to CBaseModelEntityRaw. */
    interface CRuleEntityRaw extends CBaseModelEntityRaw {
        /** CRuleEntity/m_iszMaster — Read-only, as every string field is. */
        readonly master: string;
    }

    /** The fields a CSceneEntity adds to CPointEntityRaw. */
    interface CSceneEntityRaw extends CPointEntityRaw {
        /** CSceneEntity/m_hActivator — Another entity, or null when it points at nothing. Read-only. */
        readonly activator: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hActor — Another entity, or null when it points at nothing. Read-only. */
        readonly actor: Entity<EntityRaw> | null;
        /** CSceneEntity/m_bAutogenerated */
        autogenerated: boolean;
        /** CSceneEntity/m_bAutomated */
        automated: boolean;
        /** CSceneEntity/m_nAutomatedAction */
        automatedAction: number;
        /** CSceneEntity/m_flAutomationDelay */
        automationDelay: number;
        /** CSceneEntity/m_flAutomationTime */
        automationTime: number;
        /** CSceneEntity/m_bBreakOnNonIdle */
        breakOnNonIdle: boolean;
        /** CSceneEntity/m_BusyActor */
        busyActor: number;
        /** CSceneEntity/m_bCancelAtNextInterrupt */
        cancelAtNextInterrupt: boolean;
        /** CSceneEntity/m_bCompletedEarly */
        completedEarly: boolean;
        /** CSceneEntity/m_flCurrentTime */
        currentTime: number;
        /** CSceneEntity/m_flForceClientTime */
        forceClientTime: number;
        /** CSceneEntity/m_flFrameTime */
        frameTime: number;
        /** CSceneEntity/m_hTarget1 — Another entity, or null when it points at nothing. Read-only. */
        readonly hTarget1: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hTarget2 — Another entity, or null when it points at nothing. Read-only. */
        readonly hTarget2: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hTarget3 — Another entity, or null when it points at nothing. Read-only. */
        readonly hTarget3: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hTarget4 — Another entity, or null when it points at nothing. Read-only. */
        readonly hTarget4: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hTarget5 — Another entity, or null when it points at nothing. Read-only. */
        readonly hTarget5: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hTarget6 — Another entity, or null when it points at nothing. Read-only. */
        readonly hTarget6: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hTarget7 — Another entity, or null when it points at nothing. Read-only. */
        readonly hTarget7: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hTarget8 — Another entity, or null when it points at nothing. Read-only. */
        readonly hTarget8: Entity<EntityRaw> | null;
        /** CSceneEntity/m_nInterruptCount */
        interruptCount: number;
        /** CSceneEntity/m_hInterruptScene — Another entity, or null when it points at nothing. Read-only. */
        readonly interruptScene: Entity<EntityRaw> | null;
        /** CSceneEntity/m_bInterruptSceneFinished */
        interruptSceneFinished: boolean;
        /** CSceneEntity/m_bInterrupted */
        interrupted: boolean;
        /** CSceneEntity/m_bInterruptedActorsScenes */
        interruptedActorsScenes: boolean;
        /** CSceneEntity/m_bIsPlayingBack */
        isPlayingBack: boolean;
        /** CSceneEntity/m_iszTarget1 — Read-only, as every string field is. */
        readonly iszTarget1: string;
        /** CSceneEntity/m_iszTarget2 — Read-only, as every string field is. */
        readonly iszTarget2: string;
        /** CSceneEntity/m_iszTarget3 — Read-only, as every string field is. */
        readonly iszTarget3: string;
        /** CSceneEntity/m_iszTarget4 — Read-only, as every string field is. */
        readonly iszTarget4: string;
        /** CSceneEntity/m_iszTarget5 — Read-only, as every string field is. */
        readonly iszTarget5: string;
        /** CSceneEntity/m_iszTarget6 — Read-only, as every string field is. */
        readonly iszTarget6: string;
        /** CSceneEntity/m_iszTarget7 — Read-only, as every string field is. */
        readonly iszTarget7: string;
        /** CSceneEntity/m_iszTarget8 — Read-only, as every string field is. */
        readonly iszTarget8: string;
        /** CSceneEntity/m_hLocatorOrigin — Another entity, or null when it points at nothing. Read-only. */
        readonly locatorOrigin: Entity<EntityRaw> | null;
        /** CSceneEntity/m_bMultiplayer */
        multiplayer: boolean;
        /** CSceneEntity/m_bPauseAtNextInterrupt */
        pauseAtNextInterrupt: boolean;
        /** CSceneEntity/m_bPaused */
        paused: boolean;
        /** CSceneEntity/m_bPausedViaInput */
        pausedViaInput: boolean;
        /** CSceneEntity/m_fPitch */
        pitch: number;
        /** CSceneEntity/m_iPlayerDeathBehavior — A SceneOnPlayerDeath_t. */
        playerDeathBehavior: number;
        /** CSceneEntity/m_bRestoring */
        restoring: boolean;
        /** CSceneEntity/m_iszSceneFile — Read-only, as every string field is. */
        readonly sceneFile: string;
        /** CSceneEntity/m_bSceneFinished */
        sceneFinished: boolean;
        /** CSceneEntity/m_bSceneMissing */
        sceneMissing: boolean;
        /** CSceneEntity/m_nSceneStringIndex */
        sceneStringIndex: number;
        /** CSceneEntity/m_iszSequenceName — Read-only, as every string field is. */
        readonly sequenceName: string;
        /** CSceneEntity/m_iszSoundName — Read-only, as every string field is. */
        readonly soundName: string;
        /** CSceneEntity/m_nSpeechPriority */
        speechPriority: number;
        /** CSceneEntity/m_sTargetAttachment — Read-only, as every string field is. */
        readonly targetAttachment: string;
        /** CSceneEntity/m_bWaitingForActor */
        waitingForActor: boolean;
        /** CSceneEntity/m_bWaitingForInterrupt */
        waitingForInterrupt: boolean;
    }

    /** The fields a CServerOnlyModelEntity adds to CBaseModelEntityRaw. */
    interface CServerOnlyModelEntityRaw extends CBaseModelEntityRaw {
    }

    /** The fields a CServerOnlyPointEntity adds to CServerOnlyEntityRaw. */
    interface CServerOnlyPointEntityRaw extends CServerOnlyEntityRaw {
    }

    /** The fields a CShatterGlassShardPhysics adds to CBaseModelEntityRaw. */
    interface CShatterGlassShardPhysicsRaw extends CBaseModelEntityRaw {
        /** CShatterGlassShardPhysics/m_hParentShard */
        parentShard: number;
        /** CShatterGlassShardPhysics/m_nPoolState — A ShatterGlassEntityPoolState_t. */
        poolState: number;
        /** CShatterGlassShardPhysics/m_bTouchedByPlayer */
        touchedByPlayer: boolean;
    }

    /** The fields a CSoundAreaEntityOrientedBox adds to CSoundAreaEntityBaseRaw. */
    interface CSoundAreaEntityOrientedBoxRaw extends CSoundAreaEntityBaseRaw {
    }

    /** The fields a CSoundAreaEntitySphere adds to CSoundAreaEntityBaseRaw. */
    interface CSoundAreaEntitySphereRaw extends CSoundAreaEntityBaseRaw {
        /** CSoundAreaEntitySphere/m_flRadius */
        radius: number;
    }

    /** The fields a CSoundEventAABBEntity adds to CSoundEventEntityRaw. */
    interface CSoundEventAABBEntityRaw extends CSoundEventEntityRaw {
    }

    /** The fields a CSoundEventConeEntity adds to CSoundEventEntityRaw. */
    interface CSoundEventConeEntityRaw extends CSoundEventEntityRaw {
        /** CSoundEventConeEntity/m_flAttenMax */
        attenMax: number;
        /** CSoundEventConeEntity/m_flAttenMin */
        attenMin: number;
        /** CSoundEventConeEntity/m_flEmitterAngle */
        emitterAngle: number;
        /** CSoundEventConeEntity/m_iszParameterName — Read-only, as every string field is. */
        readonly parameterName: string;
        /** CSoundEventConeEntity/m_flSweetSpotAngle */
        sweetSpotAngle: number;
    }

    /** The fields a CSoundEventEntityAlias_snd_event_point adds to CSoundEventEntityRaw. */
    interface CSoundEventEntityAlias_snd_event_pointRaw extends CSoundEventEntityRaw {
    }

    /** The fields a CSoundEventOBBEntity adds to CSoundEventEntityRaw. */
    interface CSoundEventOBBEntityRaw extends CSoundEventEntityRaw {
    }

    /** The fields a CSoundEventPathCornerEntity adds to CSoundEventEntityRaw. */
    interface CSoundEventPathCornerEntityRaw extends CSoundEventEntityRaw {
        /** CSoundEventPathCornerEntity/m_iCountMax */
        countMax: number;
        /** CSoundEventPathCornerEntity/m_flDistMaxSqr */
        distMaxSqr: number;
        /** CSoundEventPathCornerEntity/m_flDistanceMax */
        distanceMax: number;
        /** CSoundEventPathCornerEntity/m_flDotProductMax */
        dotProductMax: number;
        /** CSoundEventPathCornerEntity/m_iszPathCorner — Read-only, as every string field is. */
        readonly pathCorner: string;
        /** CSoundEventPathCornerEntity/m_bPlaying */
        playing: boolean;
    }

    /** The fields a CSoundEventSphereEntity adds to CSoundEventEntityRaw. */
    interface CSoundEventSphereEntityRaw extends CSoundEventEntityRaw {
        /** CSoundEventSphereEntity/m_flRadius */
        radius: number;
    }

    /** The fields a CSoundOpvarSetOBBWindEntity adds to CSoundOpvarSetPointBaseRaw. */
    interface CSoundOpvarSetOBBWindEntityRaw extends CSoundOpvarSetPointBaseRaw {
        /** CSoundOpvarSetOBBWindEntity/m_flWindMapMax */
        windMapMax: number;
        /** CSoundOpvarSetOBBWindEntity/m_flWindMapMin */
        windMapMin: number;
        /** CSoundOpvarSetOBBWindEntity/m_flWindMax */
        windMax: number;
        /** CSoundOpvarSetOBBWindEntity/m_flWindMin */
        windMin: number;
    }

    /** The fields a CSoundOpvarSetPointEntity adds to CSoundOpvarSetPointBaseRaw. */
    interface CSoundOpvarSetPointEntityRaw extends CSoundOpvarSetPointBaseRaw {
        /** CSoundOpvarSetPointEntity/m_bAutoDisable */
        autoDisable: boolean;
        /** CSoundOpvarSetPointEntity/m_flDistanceMapMax */
        distanceMapMax: number;
        /** CSoundOpvarSetPointEntity/m_flDistanceMapMin */
        distanceMapMin: number;
        /** CSoundOpvarSetPointEntity/m_flDistanceMax */
        distanceMax: number;
        /** CSoundOpvarSetPointEntity/m_flDistanceMin */
        distanceMin: number;
        /** CSoundOpvarSetPointEntity/m_hDynamicEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly dynamicEntity: Entity<EntityRaw> | null;
        /** CSoundOpvarSetPointEntity/m_iszDynamicEntityName — Read-only, as every string field is. */
        readonly dynamicEntityName: string;
        /** CSoundOpvarSetPointEntity/m_flDynamicMaximumOcclusion */
        dynamicMaximumOcclusion: number;
        /** CSoundOpvarSetPointEntity/m_flOcclusionMax */
        occlusionMax: number;
        /** CSoundOpvarSetPointEntity/m_flOcclusionMin */
        occlusionMin: number;
        /** CSoundOpvarSetPointEntity/m_flOcclusionRadius */
        occlusionRadius: number;
        /** CSoundOpvarSetPointEntity/m_flPathingDistanceNormFactor */
        pathingDistanceNormFactor: number;
        /** CSoundOpvarSetPointEntity/m_nPathingSourceIndex */
        pathingSourceIndex: number;
        /** CSoundOpvarSetPointEntity/m_bReloading */
        reloading: boolean;
        /** CSoundOpvarSetPointEntity/m_bSetValueOnDisable */
        setValueOnDisable: boolean;
        /** CSoundOpvarSetPointEntity/m_nSimulationMode */
        simulationMode: number;
        /** CSoundOpvarSetPointEntity/m_flValSetOnDisable */
        valSetOnDisable: number;
        /** CSoundOpvarSetPointEntity/m_nVisibilitySamples */
        visibilitySamples: number;
    }

    /** The fields a CSpotlightEnd adds to CBaseModelEntityRaw. */
    interface CSpotlightEndRaw extends CBaseModelEntityRaw {
        /** CSpotlightEnd/m_flLightScale */
        lightScale: number;
        /** CSpotlightEnd/m_Radius */
        radius: number;
    }

    /** The fields a CSprite adds to CBaseModelEntityRaw. */
    interface CSpriteRaw extends CBaseModelEntityRaw {
        /** CSprite/m_hAttachedToEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly attachedToEntity: Entity<EntityRaw> | null;
        /** CSprite/m_nBrightness */
        brightness: number;
        /** CSprite/m_flBrightnessDuration */
        brightnessDuration: number;
        /** CSprite/m_flBrightnessTimeStart */
        brightnessTimeStart: number;
        /** CSprite/m_nDestBrightness */
        destBrightness: number;
        /** CSprite/m_flDestScale */
        destScale: number;
        /** CSprite/m_flDieTime */
        dieTime: number;
        /** CSprite/m_flFrame */
        frame: number;
        /** CSprite/m_flGlowProxySize */
        glowProxySize: number;
        /** CSprite/m_flHDRColorScale */
        hDRColorScale: number;
        /** CSprite/m_flLastTime */
        lastTime: number;
        /** CSprite/m_flMaxFrame */
        maxFrame: number;
        /** CSprite/m_flScaleDuration */
        scaleDuration: number;
        /** CSprite/m_flScaleTimeStart */
        scaleTimeStart: number;
        /** CSprite/m_flSpeed */
        speed: number;
        /** CSprite/m_flSpriteFramerate */
        spriteFramerate: number;
        /** CSprite/m_nSpriteHeight */
        spriteHeight: number;
        /** CSprite/m_flSpriteScale */
        spriteScale: number;
        /** CSprite/m_nSpriteWidth */
        spriteWidth: number;
        /** CSprite/m_nStartBrightness */
        startBrightness: number;
        /** CSprite/m_flStartScale */
        startScale: number;
        /** CSprite/m_bWorldSpaceScale */
        worldSpaceScale: boolean;
    }

    /** The fields a CTankTargetChange adds to CPointEntityRaw. */
    interface CTankTargetChangeRaw extends CPointEntityRaw {
        /** CTankTargetChange/m_newTargetName — Read-only, as every string field is. */
        readonly newTargetName: string;
    }

    /** The fields a CTankTrainAI adds to CPointEntityRaw. */
    interface CTankTrainAIRaw extends CPointEntityRaw {
        /** CTankTrainAI/m_engineSoundName — Read-only, as every string field is. */
        readonly engineSoundName: string;
        /** CTankTrainAI/m_movementSoundName — Read-only, as every string field is. */
        readonly movementSoundName: string;
        /** CTankTrainAI/m_soundPlaying */
        soundPlaying: number;
        /** CTankTrainAI/m_startSoundName — Read-only, as every string field is. */
        readonly startSoundName: string;
        /** CTankTrainAI/m_hTargetEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly targetEntity: Entity<EntityRaw> | null;
        /** CTankTrainAI/m_targetEntityName — Read-only, as every string field is. */
        readonly targetEntityName: string;
        /** CTankTrainAI/m_hTrain — Another entity, or null when it points at nothing. Read-only. */
        readonly train: Entity<EntityRaw> | null;
    }

    /** The fields a CTextureBasedAnimatable adds to CBaseModelEntityRaw. */
    interface CTextureBasedAnimatableRaw extends CBaseModelEntityRaw {
        /** CTextureBasedAnimatable/m_flFPS */
        fPS: number;
        /** CTextureBasedAnimatable/m_bLoop */
        loop: boolean;
        /** CTextureBasedAnimatable/m_flStartFrame */
        startFrame: number;
        /** CTextureBasedAnimatable/m_flStartTime */
        startTime: number;
    }

    /** The fields a CTonemapController2Alias_env_tonemap_controller2 adds to CTonemapController2Raw. */
    interface CTonemapController2Alias_env_tonemap_controller2Raw extends CTonemapController2Raw {
    }

    /** The fields a CTriggerBrush adds to CBaseModelEntityRaw. */
    interface CTriggerBrushRaw extends CBaseModelEntityRaw {
        /** CTriggerBrush/m_iDontMessageParent */
        dontMessageParent: number;
        /** CTriggerBrush/m_iInputFilter */
        inputFilter: number;
    }

    /** The fields a CTriggerVolume adds to CBaseModelEntityRaw. */
    interface CTriggerVolumeRaw extends CBaseModelEntityRaw {
        /** CTriggerVolume/m_hFilter — Another entity, or null when it points at nothing. Read-only. */
        readonly filter: Entity<EntityRaw> | null;
        /** CTriggerVolume/m_iFilterName — Read-only, as every string field is. */
        readonly filterName: string;
    }

    /** The fields a CWorld adds to CBaseModelEntityRaw. */
    interface CWorldRaw extends CBaseModelEntityRaw {
    }

    /** The fields a CBaseAnimGraphAlias_baseanimating adds to CBaseAnimGraphRaw. */
    interface CBaseAnimGraphAlias_baseanimatingRaw extends CBaseAnimGraphRaw {
    }

    /** The fields a CBaseButton adds to CBaseToggleRaw. */
    interface CBaseButtonRaw extends CBaseToggleRaw {
        /** CBaseButton/m_hConstraint — Another entity, or null when it points at nothing. Read-only. */
        readonly constraint: Entity<EntityRaw> | null;
        /** CBaseButton/m_hConstraintParent — Another entity, or null when it points at nothing. Read-only. */
        readonly constraintParent: Entity<EntityRaw> | null;
        /** CBaseButton/m_bDisabled */
        disabled: boolean;
        /** CBaseButton/m_szDisplayText — Read-only, as every string field is. */
        readonly displayText: string;
        /** CBaseButton/m_bForceNpcExclude */
        forceNpcExclude: boolean;
        /** CBaseButton/m_glowEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly glowEntity: Entity<EntityRaw> | null;
        /** CBaseButton/m_bLocked */
        locked: boolean;
        /** CBaseButton/m_sLockedSound — Read-only, as every string field is. */
        readonly lockedSound: string;
        /** CBaseButton/m_sOverrideAnticipationName — Read-only, as every string field is. */
        readonly overrideAnticipationName: string;
        /** CBaseButton/m_fRotating */
        rotating: boolean;
        /** CBaseButton/m_sGlowEntity — Read-only, as every string field is. */
        readonly sGlowEntity: string;
        /** CBaseButton/m_bSolidBsp */
        solidBsp: boolean;
        /** CBaseButton/m_flSpeed */
        speed: number;
        /** CBaseButton/m_nState */
        state: number;
        /** CBaseButton/m_fStayPushed */
        stayPushed: boolean;
        /** CBaseButton/m_sUnlockedSound — Read-only, as every string field is. */
        readonly unlockedSound: string;
        /** CBaseButton/m_usable */
        usable: boolean;
        /** CBaseButton/m_flUseLockedTime */
        useLockedTime: number;
        /** CBaseButton/m_sUseSound — Read-only, as every string field is. */
        readonly useSound: string;
    }

    /** The fields a CBaseCombatCharacter adds to CBaseAnimGraphRaw. */
    interface CBaseCombatCharacterRaw extends CBaseAnimGraphRaw {
        /** CBaseCombatCharacter/m_bApplyStressDamage */
        applyStressDamage: boolean;
        /** CBaseCombatCharacter/m_bDeathEventsDispatched */
        deathEventsDispatched: boolean;
        /** CBaseCombatCharacter/m_bForceServerRagdoll */
        forceServerRagdoll: boolean;
        /** CBaseCombatCharacter/m_eHull — A Hull_t. */
        hull: number;
        /** CBaseCombatCharacter/m_impactEnergyScale */
        impactEnergyScale: number;
        /** CBaseCombatCharacter/m_nNavHullIdx */
        navHullIdx: number;
        /** CBaseCombatCharacter/m_strRelationships — Read-only, as every string field is. */
        readonly strRelationships: string;
    }

    /** The fields a CBaseDoor adds to CBaseToggleRaw. */
    interface CBaseDoorRaw extends CBaseToggleRaw {
        /** CBaseDoor/m_flBlockDamage */
        blockDamage: number;
        /** CBaseDoor/m_ChainTarget — Read-only, as every string field is. */
        readonly chainTarget: string;
        /** CBaseDoor/m_bCreateNavObstacle */
        createNavObstacle: boolean;
        /** CBaseDoor/m_bDoorGroup */
        doorGroup: boolean;
        /** CBaseDoor/m_bForceClosed */
        forceClosed: boolean;
        /** CBaseDoor/m_bIgnoreDebris */
        ignoreDebris: boolean;
        /** CBaseDoor/m_isChaining */
        isChaining: boolean;
        /** CBaseDoor/m_bIsUsable */
        isUsable: boolean;
        /** CBaseDoor/m_bLocked */
        locked: boolean;
        /** CBaseDoor/m_bLoopMoveSound */
        loopMoveSound: boolean;
        /** CBaseDoor/m_bNoNPCs */
        noNPCs: boolean;
        /** CBaseDoor/m_NoiseArrived — Read-only, as every string field is. */
        readonly noiseArrived: string;
        /** CBaseDoor/m_NoiseArrivedClosed — Read-only, as every string field is. */
        readonly noiseArrivedClosed: string;
        /** CBaseDoor/m_NoiseMoving — Read-only, as every string field is. */
        readonly noiseMoving: string;
        /** CBaseDoor/m_NoiseMovingClosed — Read-only, as every string field is. */
        readonly noiseMovingClosed: string;
        /** CBaseDoor/m_eSpawnPosition — A FuncDoorSpawnPos_t. */
        spawnPosition: number;
        /** CBaseDoor/m_flSpeed */
        speed: number;
    }

    /** The fields a CBaseFilter adds to CLogicalEntityRaw. */
    interface CBaseFilterRaw extends CLogicalEntityRaw {
        /** CBaseFilter/m_bNegated */
        negated: boolean;
    }

    /** The fields a CBaseGrenade adds to CBaseAnimGraphRaw. */
    interface CBaseGrenadeRaw extends CBaseAnimGraphRaw {
        /** CBaseGrenade/m_iszBounceSound — Read-only, as every string field is. */
        readonly bounceSound: string;
        /** CBaseGrenade/m_flDamage */
        damage: number;
        /** CBaseGrenade/m_bDamageDetonating */
        damageDetonating: boolean;
        /** CBaseGrenade/m_flDetonateTime */
        detonateTime: number;
        /** CBaseGrenade/m_DmgRadius */
        dmgRadius: number;
        /** CBaseGrenade/m_ExplosionSound — Read-only, as every string field is. */
        readonly explosionSound: string;
        /** CBaseGrenade/m_bHasWarnedAI */
        hasWarnedAI: boolean;
        /** CBaseGrenade/m_bIsLive */
        isLive: boolean;
        /** CBaseGrenade/m_bIsSmokeGrenade */
        isSmokeGrenade: boolean;
        /** CBaseGrenade/m_flNextAttack */
        nextAttack: number;
        /** CBaseGrenade/m_hOriginalThrower — Another entity, or null when it points at nothing. Read-only. */
        readonly originalThrower: Entity<EntityRaw> | null;
        /** CBaseGrenade/m_hThrower — Another entity, or null when it points at nothing. Read-only. */
        readonly thrower: Entity<EntityRaw> | null;
        /** CBaseGrenade/m_flWarnAITime */
        warnAITime: number;
    }

    /** The fields a CBasePlatTrain adds to CBaseToggleRaw. */
    interface CBasePlatTrainRaw extends CBaseToggleRaw {
        /** CBasePlatTrain/m_NoiseArrived — Read-only, as every string field is. */
        readonly noiseArrived: string;
        /** CBasePlatTrain/m_NoiseMoving — Read-only, as every string field is. */
        readonly noiseMoving: string;
        /** CBasePlatTrain/m_flTLength */
        tLength: number;
        /** CBasePlatTrain/m_flTWidth */
        tWidth: number;
        /** CBasePlatTrain/m_volume */
        volume: number;
    }

    /** The fields a CBaseProp adds to CBaseAnimGraphRaw. */
    interface CBasePropRaw extends CBaseAnimGraphRaw {
        /** CBaseProp/m_bConformToCollisionBounds */
        conformToCollisionBounds: boolean;
        /** CBaseProp/m_bModelOverrodeBlockLOS */
        modelOverrodeBlockLOS: boolean;
        /** CBaseProp/m_iShapeType */
        shapeType: number;
    }

    /** The fields a CBaseTrigger adds to CBaseToggleRaw. */
    interface CBaseTriggerRaw extends CBaseToggleRaw {
        /** CBaseTrigger/m_bDisabled */
        disabled: boolean;
        /** CBaseTrigger/m_hFilter — Another entity, or null when it points at nothing. Read-only. */
        readonly filter: Entity<EntityRaw> | null;
        /** CBaseTrigger/m_iFilterName — Read-only, as every string field is. */
        readonly filterName: string;
        /** CBaseTrigger/m_bUseAsyncQueries */
        useAsyncQueries: boolean;
    }

    /** The fields a CCSGO_TeamIntroCounterTerroristPosition adds to CCSGO_TeamIntroCharacterPositionRaw. */
    interface CCSGO_TeamIntroCounterTerroristPositionRaw extends CCSGO_TeamIntroCharacterPositionRaw {
    }

    /** The fields a CCSGO_TeamIntroTerroristPosition adds to CCSGO_TeamIntroCharacterPositionRaw. */
    interface CCSGO_TeamIntroTerroristPositionRaw extends CCSGO_TeamIntroCharacterPositionRaw {
    }

    /** The fields a CCSGO_TeamSelectCounterTerroristPosition adds to CCSGO_TeamSelectCharacterPositionRaw. */
    interface CCSGO_TeamSelectCounterTerroristPositionRaw extends CCSGO_TeamSelectCharacterPositionRaw {
    }

    /** The fields a CCSGO_TeamSelectTerroristPosition adds to CCSGO_TeamSelectCharacterPositionRaw. */
    interface CCSGO_TeamSelectTerroristPositionRaw extends CCSGO_TeamSelectCharacterPositionRaw {
    }

    /** The fields a CCSGO_WingmanIntroCharacterPosition adds to CCSGO_TeamIntroCharacterPositionRaw. */
    interface CCSGO_WingmanIntroCharacterPositionRaw extends CCSGO_TeamIntroCharacterPositionRaw {
    }

    /** The fields a CCSPlace adds to CServerOnlyModelEntityRaw. */
    interface CCSPlaceRaw extends CServerOnlyModelEntityRaw {
        /** CCSPlace/m_name — Read-only, as every string field is. */
        readonly name: string;
    }

    /** The fields a CCSSprite adds to CSpriteRaw. */
    interface CCSSpriteRaw extends CSpriteRaw {
    }

    /** The fields a CCommentaryViewPosition adds to CSpriteRaw. */
    interface CCommentaryViewPositionRaw extends CSpriteRaw {
    }

    /** The fields a CConstraintAnchor adds to CBaseAnimGraphRaw. */
    interface CConstraintAnchorRaw extends CBaseAnimGraphRaw {
        /** CConstraintAnchor/m_massScale */
        massScale: number;
    }

    /** The fields a CEconEntity adds to CBaseAnimGraphRaw. */
    interface CEconEntityRaw extends CBaseAnimGraphRaw {
        /** CEconEntity/m_nFallbackPaintKit */
        fallbackPaintKit: number;
        /** CEconEntity/m_nFallbackSeed */
        fallbackSeed: number;
        /** CEconEntity/m_nFallbackStatTrak */
        fallbackStatTrak: number;
        /** CEconEntity/m_flFallbackWear */
        fallbackWear: number;
        /** CEconEntity/m_iOldOwnerClass */
        oldOwnerClass: number;
        /** CEconEntity/m_hOldProvidee — Another entity, or null when it points at nothing. Read-only. */
        readonly oldProvidee: Entity<EntityRaw> | null;
        /** CEconEntity/m_OriginalOwnerXuidHigh */
        originalOwnerXuidHigh: number;
        /** CEconEntity/m_OriginalOwnerXuidLow */
        originalOwnerXuidLow: number;
    }

    /** Every field a CEnvBeam has, by name. Flattened: it reuses a base field's name for a different type. */
    interface CEnvBeamRaw {
        /** CEnvBeam/m_active */
        active: number;
        /** CBaseEntity/m_flActualGravityScale */
        actualGravityScale: number;
        /** CBaseEntity/m_nActualMoveType — A MoveType_t. */
        actualMoveType: number;
        /** CBaseModelEntity/m_bAllowFadeInView */
        allowFadeInView: boolean;
        /** CBeam/m_fAmplitude */
        amplitude: number;
        /** CBaseEntity/m_flAnimTime */
        animTime: number;
        /** CBaseEntity/m_bAnimatedEveryTick */
        animatedEveryTick: boolean;
        /** CBeam/m_nBeamFlags */
        beamFlags: number;
        /** CBeam/m_nBeamType — A BeamType_t. */
        beamType: number;
        /** CBaseEntity/m_pBlocker — Another entity, or null when it points at nothing. Read-only. */
        readonly blocker: Entity<EntityRaw> | null;
        /** CBaseEntity/m_nBloodType — A BloodType. */
        bloodType: number;
        /** CEnvBeam/m_boltWidth */
        boltWidth: number;
        /** CBaseEntity/m_bClientSideRagdoll */
        clientSideRagdoll: boolean;
        /** CBaseEntity/m_flCreateTime */
        createTime: number;
        /** CBaseEntity/m_iCurrentThinkContext */
        currentThinkContext: number;
        /** CBeam/m_flDamage */
        damage: number;
        /** CBaseEntity/m_flDamageAccumulator */
        damageAccumulator: number;
        /** CBaseEntity/m_hDamageFilter — Another entity, or null when it points at nothing. Read-only. */
        readonly damageFilter: Entity<EntityRaw> | null;
        /** CBaseEntity/m_iszDamageFilterName — Read-only, as every string field is. */
        readonly damageFilterName: string;
        /** CEnvBeam/m_iszDecal — Read-only, as every string field is. */
        readonly decal: string;
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
        /** CBaseModelEntity/m_flDissolveStartTime */
        dissolveStartTime: number;
        /** CBeam/m_nDissolveType */
        dissolveType: number;
        /** CBaseEntity/m_iEFlags */
        eFlags: number;
        /** CBaseEntity/m_hEffectEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly effectEntity: Entity<EntityRaw> | null;
        /** CBaseEntity/m_fEffects */
        effects: number;
        /** CBaseEntity/m_flElasticity */
        elasticity: number;
        /** CEnvBeam/m_iszEndEntity — Read-only, as every string field is. */
        readonly endEntity: string;
        /** CBeam/m_fEndWidth */
        endWidth: number;
        /** CBeam/m_fFadeLength */
        fadeLength: number;
        /** CBaseModelEntity/m_fadeMaxDist */
        fadeMaxDist: number;
        /** CBaseModelEntity/m_fadeMinDist */
        fadeMinDist: number;
        /** CBaseModelEntity/m_flFadeScale */
        fadeScale: number;
        /** CEnvBeam/m_hFilter — Another entity, or null when it points at nothing. Read-only. */
        readonly filter: Entity<EntityRaw> | null;
        /** CEnvBeam/m_iFilterName — Read-only, as every string field is. */
        readonly filterName: string;
        /** CBeam/m_flFireTime */
        fireTime: number;
        /** CBaseEntity/m_fFlags */
        flags: number;
        /** CBeam/m_flFrame */
        frame: number;
        /** CBeam/m_flFrameRate */
        frameRate: number;
        /** CEnvBeam/m_frameStart */
        frameStart: number;
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
        /** CBaseEntity/m_nGroundBodyIndex */
        groundBodyIndex: number;
        /** CBaseEntity/m_hGroundEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly groundEntity: Entity<EntityRaw> | null;
        /** CBeam/m_flHDRColorScale */
        hDRColorScale: number;
        /** CBeam/m_fHaloScale */
        haloScale: number;
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
        /** CEnvBeam/m_life */
        life: number;
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
        /** CBaseModelEntity/m_bNoInterpolate */
        noInterpolate: boolean;
        /** CEnvBeam/m_noiseAmplitude */
        noiseAmplitude: number;
        /** CBeam/m_nNumBeamEnts */
        numBeamEnts: number;
        /** CBaseModelEntity/m_nObjectCulling */
        objectCulling: number;
        /** CBaseEntity/m_hOwnerEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly ownerEntity: Entity<EntityRaw> | null;
        /** CBaseEntity/m_nPlatformType — A EntityPlatformTypes_t. */
        platformType: number;
        /** CBaseEntity/m_nPreviouslySetMoveType — A MoveType_t. */
        previouslySetMoveType: number;
        /** CEntityInstance/m_iszPrivateVScripts — Read-only, as every string field is. */
        readonly privateVScripts: string;
        /** CBaseEntity/m_nPushEnumCount */
        pushEnumCount: number;
        /** CEnvBeam/m_radius */
        radius: number;
        /** CBaseModelEntity/m_nRenderFX — A RenderFx_t. */
        renderFX: number;
        /** CBaseModelEntity/m_nRenderMode — A RenderMode_t. */
        renderMode: number;
        /** CBaseModelEntity/m_bRenderToCubemaps */
        renderToCubemaps: boolean;
        /** CBaseEntity/m_iszResponseContext — Read-only, as every string field is. */
        readonly responseContext: string;
        /** CBaseEntity/m_bRestoreInHierarchy */
        restoreInHierarchy: boolean;
        /** CEnvBeam/m_restrike */
        restrike: number;
        /** CBaseEntity/m_iSentToClients */
        sentToClients: number;
        /** CBaseModelEntity/m_flShadowStrength */
        shadowStrength: number;
        /** CBaseEntity/m_nSimulationTick */
        simulationTick: number;
        /** CBaseEntity/m_flSimulationTime */
        simulationTime: number;
        /** CBaseEntity/m_nSlimeTouch */
        slimeTouch: number;
        /** CBaseEntity/m_spawnflags */
        spawnflags: number;
        /** CEnvBeam/m_speed */
        speed: number;
        /** CEnvBeam/m_iszSpriteName — Read-only, as every string field is. */
        readonly spriteName: string;
        /** CEnvBeam/m_iszStartEntity — Read-only, as every string field is. */
        readonly startEntity: string;
        /** CBeam/m_fStartFrame */
        startFrame: number;
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
        /** CEnvBeam/m_TouchType — A Touch_t. */
        touchType: number;
        /** CBeam/m_bTurnedOff */
        turnedOff: boolean;
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
        /** CBeam/m_fWidth */
        width: number;
    }

    /** The fields a CEnvExplosion adds to CModelPointEntityRaw. */
    interface CEnvExplosionRaw extends CModelPointEntityRaw {
        /** CEnvExplosion/m_iClassIgnore — A Class_T. */
        classIgnore: number;
        /** CEnvExplosion/m_iClassIgnore2 — A Class_T. */
        classIgnore2: number;
        /** CEnvExplosion/m_bCreateDebris */
        createDebris: boolean;
        /** CEnvExplosion/m_iCustomDamageType — A DamageTypes_t. */
        customDamageType: number;
        /** CEnvExplosion/m_iszCustomEffectName — Read-only, as every string field is. */
        readonly customEffectName: string;
        /** CEnvExplosion/m_iszCustomSoundName — Read-only, as every string field is. */
        readonly customSoundName: string;
        /** CEnvExplosion/m_flDamageForce */
        damageForce: number;
        /** CEnvExplosion/m_hEntityIgnore — Another entity, or null when it points at nothing. Read-only. */
        readonly entityIgnore: Entity<EntityRaw> | null;
        /** CEnvExplosion/m_iszEntityIgnoreName — Read-only, as every string field is. */
        readonly entityIgnoreName: string;
        /** CEnvExplosion/m_hInflictor — Another entity, or null when it points at nothing. Read-only. */
        readonly inflictor: Entity<EntityRaw> | null;
        /** CEnvExplosion/m_flInnerRadius */
        innerRadius: number;
        /** CEnvExplosion/m_iMagnitude */
        magnitude: number;
        /** CEnvExplosion/m_flPlayerDamage */
        playerDamage: number;
        /** CEnvExplosion/m_iRadiusOverride */
        radiusOverride: number;
        /** CEnvExplosion/m_bSuppressParticleImpulse */
        suppressParticleImpulse: boolean;
    }

    /** The fields a CEnvFade adds to CLogicalEntityRaw. */
    interface CEnvFadeRaw extends CLogicalEntityRaw {
        /** CEnvFade/m_Duration */
        duration: number;
        /** CEnvFade/m_HoldDuration */
        holdDuration: number;
    }

    /** The fields a CEnvGlobal adds to CLogicalEntityRaw. */
    interface CEnvGlobalRaw extends CLogicalEntityRaw {
        /** CEnvGlobal/m_counter */
        counter: number;
        /** CEnvGlobal/m_globalstate — Read-only, as every string field is. */
        readonly globalstate: string;
        /** CEnvGlobal/m_initialstate */
        initialstate: number;
        /** CEnvGlobal/m_triggermode */
        triggermode: number;
    }

    /** The fields a CEnvLaser adds to CBeamRaw. */
    interface CEnvLaserRaw extends CBeamRaw {
        /** CEnvLaser/m_iszLaserTarget — Read-only, as every string field is. */
        readonly laserTarget: string;
        /** CEnvLaser/m_pSprite — Another entity, or null when it points at nothing. Read-only. */
        readonly sprite: Entity<EntityRaw> | null;
        /** CEnvLaser/m_iszSpriteName — Read-only, as every string field is. */
        readonly spriteName: string;
        /** CEnvLaser/m_flStartFrame */
        startFrame: number;
    }

    /** The fields a CEnvParticleGlow adds to CParticleSystemRaw. */
    interface CEnvParticleGlowRaw extends CParticleSystemRaw {
        /** CEnvParticleGlow/m_flAlphaScale */
        alphaScale: number;
        /** CEnvParticleGlow/m_flRadiusScale */
        radiusScale: number;
        /** CEnvParticleGlow/m_flSelfIllumScale */
        selfIllumScale: number;
    }

    /** The fields a CEnvSoundscapeProxyAlias_snd_soundscape_proxy adds to CEnvSoundscapeProxyRaw. */
    interface CEnvSoundscapeProxyAlias_snd_soundscape_proxyRaw extends CEnvSoundscapeProxyRaw {
    }

    /** The fields a CEnvSoundscapeTriggerableAlias_snd_soundscape_triggerable adds to CEnvSoundscapeTriggerableRaw. */
    interface CEnvSoundscapeTriggerableAlias_snd_soundscape_triggerableRaw extends CEnvSoundscapeTriggerableRaw {
    }

    /** The fields a CFireCrackerBlast adds to CInfernoRaw. */
    interface CFireCrackerBlastRaw extends CInfernoRaw {
    }

    /** The fields a CFish adds to CBaseAnimGraphRaw. */
    interface CFishRaw extends CBaseAnimGraphRaw {
        /** CFish/m_angle */
        angle: number;
        /** CFish/m_angleChange */
        angleChange: number;
        /** CFish/m_avoidRange */
        avoidRange: number;
        /** CFish/m_calmSpeed */
        calmSpeed: number;
        /** CFish/m_desiredSpeed */
        desiredSpeed: number;
        /** CFish/m_waterLevel */
        fishWaterLevel: number;
        /** CFish/m_id */
        id: number;
        /** CFish/m_panicSpeed */
        panicSpeed: number;
        /** CFish/m_pool — Another entity, or null when it points at nothing. Read-only. */
        readonly pool: Entity<EntityRaw> | null;
        /** CFish/m_speed */
        speed: number;
        /** CFish/m_turnClockwise */
        turnClockwise: boolean;
        /** CFish/m_x */
        x: number;
        /** CFish/m_y */
        y: number;
        /** CFish/m_z */
        z: number;
    }

    /** The fields a CFogVolume adds to CServerOnlyModelEntityRaw. */
    interface CFogVolumeRaw extends CServerOnlyModelEntityRaw {
        /** CFogVolume/m_colorCorrectionName — Read-only, as every string field is. */
        readonly colorCorrectionName: string;
        /** CFogVolume/m_bDisabled */
        disabled: boolean;
        /** CFogVolume/m_fogName — Read-only, as every string field is. */
        readonly fogName: string;
        /** CFogVolume/m_bInFogVolumesList */
        inFogVolumesList: boolean;
        /** CFogVolume/m_postProcessName — Read-only, as every string field is. */
        readonly postProcessName: string;
    }

    /** The fields a CFuncElectrifiedVolume adds to CFuncBrushRaw. */
    interface CFuncElectrifiedVolumeRaw extends CFuncBrushRaw {
        /** CFuncElectrifiedVolume/m_EffectInterpenetrateName — Read-only, as every string field is. */
        readonly effectInterpenetrateName: string;
        /** CFuncElectrifiedVolume/m_EffectName — Read-only, as every string field is. */
        readonly effectName: string;
        /** CFuncElectrifiedVolume/m_iszEffectSource — Read-only, as every string field is. */
        readonly effectSource: string;
        /** CFuncElectrifiedVolume/m_EffectZapName — Read-only, as every string field is. */
        readonly effectZapName: string;
    }

    /** The fields a CFuncLadderAlias_func_useableladder adds to CFuncLadderRaw. */
    interface CFuncLadderAlias_func_useableladderRaw extends CFuncLadderRaw {
    }

    /** The fields a CFuncMonitor adds to CFuncBrushRaw. */
    interface CFuncMonitorRaw extends CFuncBrushRaw {
        /** CFuncMonitor/m_brushModelName — Read-only, as every string field is. */
        readonly brushModelName: string;
        /** CFuncMonitor/m_bDraw3DSkybox */
        draw3DSkybox: boolean;
        /** CFuncMonitor/m_bEnabled */
        enabled: boolean;
        /** CFuncMonitor/m_hTargetCamera — Another entity, or null when it points at nothing. Read-only. */
        readonly hTargetCamera: Entity<EntityRaw> | null;
        /** CFuncMonitor/m_bRenderShadows */
        renderShadows: boolean;
        /** CFuncMonitor/m_nResolutionEnum */
        resolutionEnum: number;
        /** CFuncMonitor/m_bStartEnabled */
        startEnabled: boolean;
        /** CFuncMonitor/m_targetCamera — Read-only, as every string field is. */
        readonly targetCamera: string;
        /** CFuncMonitor/m_bUseUniqueColorTarget */
        useUniqueColorTarget: boolean;
    }

    /** The fields a CFuncMoveLinear adds to CBaseToggleRaw. */
    interface CFuncMoveLinearRaw extends CBaseToggleRaw {
        /** CFuncMoveLinear/m_bAllowMovableNavMeshDockingOnEntireEntity */
        allowMovableNavMeshDockingOnEntireEntity: boolean;
        /** CFuncMoveLinear/m_authoredPosition — A MoveLinearAuthoredPos_t. */
        authoredPosition: number;
        /** CFuncMoveLinear/m_flBlockDamage */
        blockDamage: number;
        /** CFuncMoveLinear/m_bCreateMovableNavMesh */
        createMovableNavMesh: boolean;
        /** CFuncMoveLinear/m_bCreateNavObstacle */
        createNavObstacle: boolean;
        /** CFuncMoveLinear/m_currentSound — Read-only, as every string field is. */
        readonly currentSound: string;
        /** CFuncMoveLinear/m_soundStart — Read-only, as every string field is. */
        readonly soundStart: string;
        /** CFuncMoveLinear/m_soundStop — Read-only, as every string field is. */
        readonly soundStop: string;
        /** CFuncMoveLinear/m_flSpeed */
        speed: number;
        /** CFuncMoveLinear/m_flStartPosition */
        startPosition: number;
    }

    /** The fields a CFuncMoverRouter adds to CLogicalEntityRaw. */
    interface CFuncMoverRouterRaw extends CLogicalEntityRaw {
        /** CFuncMoverRouter/m_nMoverIndex */
        moverIndex: number;
        /** CFuncMoverRouter/m_hPathMover — Another entity, or null when it points at nothing. Read-only. */
        readonly pathMover: Entity<EntityRaw> | null;
        /** CFuncMoverRouter/m_iszPathMoverName — Read-only, as every string field is. */
        readonly pathMoverName: string;
        /** CFuncMoverRouter/m_bRouteToAllMovers */
        routeToAllMovers: boolean;
    }

    /** The fields a CFuncTankTrain adds to CFuncTrackTrainRaw. */
    interface CFuncTankTrainRaw extends CFuncTrackTrainRaw {
    }

    /** The fields a CFuncWallToggle adds to CFuncWallRaw. */
    interface CFuncWallToggleRaw extends CFuncWallRaw {
    }

    /** The fields a CGunTarget adds to CBaseToggleRaw. */
    interface CGunTargetRaw extends CBaseToggleRaw {
        /** CGunTarget/m_on */
        on: boolean;
        /** CGunTarget/m_flSpeed */
        speed: number;
        /** CGunTarget/m_hTargetEnt — Another entity, or null when it points at nothing. Read-only. */
        readonly targetEnt: Entity<EntityRaw> | null;
    }

    /** The fields a CHostageCarriableProp adds to CBaseAnimGraphRaw. */
    interface CHostageCarriablePropRaw extends CBaseAnimGraphRaw {
    }

    /** The fields a CInfoDynamicShadowHintBox adds to CInfoDynamicShadowHintRaw. */
    interface CInfoDynamicShadowHintBoxRaw extends CInfoDynamicShadowHintRaw {
    }

    /** The fields a CInfoSpawnGroupLoadUnload adds to CLogicalEntityRaw. */
    interface CInfoSpawnGroupLoadUnloadRaw extends CLogicalEntityRaw {
        /** CInfoSpawnGroupLoadUnload/m_bAutoActivate */
        autoActivate: boolean;
        /** CInfoSpawnGroupLoadUnload/m_sFixedSpawnGroupName — Read-only, as every string field is. */
        readonly fixedSpawnGroupName: string;
        /** CInfoSpawnGroupLoadUnload/m_iszLandmarkName — Read-only, as every string field is. */
        readonly landmarkName: string;
        /** CInfoSpawnGroupLoadUnload/m_bQueueActiveSpawnGroupChange */
        queueActiveSpawnGroupChange: boolean;
        /** CInfoSpawnGroupLoadUnload/m_bQueueFinishLoading */
        queueFinishLoading: boolean;
        /** CInfoSpawnGroupLoadUnload/m_iszSpawnGroupFilterName — Read-only, as every string field is. */
        readonly spawnGroupFilterName: string;
        /** CInfoSpawnGroupLoadUnload/m_iszSpawnGroupName — Read-only, as every string field is. */
        readonly spawnGroupName: string;
        /** CInfoSpawnGroupLoadUnload/m_flTimeoutInterval */
        timeoutInterval: number;
        /** CInfoSpawnGroupLoadUnload/m_bUnloadingStarted */
        unloadingStarted: boolean;
    }

    /** The fields a CInfoTargetServerOnly adds to CServerOnlyPointEntityRaw. */
    interface CInfoTargetServerOnlyRaw extends CServerOnlyPointEntityRaw {
    }

    /** Every field a CInstancedSceneEntity has, by name. Flattened: it reuses a base field's name for a different type. */
    interface CInstancedSceneEntityRaw {
        /** CSceneEntity/m_hActivator — Another entity, or null when it points at nothing. Read-only. */
        readonly activator: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hActor — Another entity, or null when it points at nothing. Read-only. */
        readonly actor: Entity<EntityRaw> | null;
        /** CBaseEntity/m_flActualGravityScale */
        actualGravityScale: number;
        /** CBaseEntity/m_nActualMoveType — A MoveType_t. */
        actualMoveType: number;
        /** CBaseEntity/m_flAnimTime */
        animTime: number;
        /** CBaseEntity/m_bAnimatedEveryTick */
        animatedEveryTick: boolean;
        /** CSceneEntity/m_bAutogenerated */
        autogenerated: boolean;
        /** CSceneEntity/m_bAutomated */
        automated: boolean;
        /** CSceneEntity/m_nAutomatedAction */
        automatedAction: number;
        /** CSceneEntity/m_flAutomationDelay */
        automationDelay: number;
        /** CSceneEntity/m_flAutomationTime */
        automationTime: number;
        /** CBaseEntity/m_pBlocker — Another entity, or null when it points at nothing. Read-only. */
        readonly blocker: Entity<EntityRaw> | null;
        /** CBaseEntity/m_nBloodType — A BloodType. */
        bloodType: number;
        /** CSceneEntity/m_bBreakOnNonIdle */
        breakOnNonIdle: boolean;
        /** CSceneEntity/m_BusyActor */
        busyActor: number;
        /** CSceneEntity/m_bCancelAtNextInterrupt */
        cancelAtNextInterrupt: boolean;
        /** CBaseEntity/m_bClientSideRagdoll */
        clientSideRagdoll: boolean;
        /** CSceneEntity/m_bCompletedEarly */
        completedEarly: boolean;
        /** CBaseEntity/m_flCreateTime */
        createTime: number;
        /** CBaseEntity/m_iCurrentThinkContext */
        currentThinkContext: number;
        /** CSceneEntity/m_flCurrentTime */
        currentTime: number;
        /** CBaseEntity/m_flDamageAccumulator */
        damageAccumulator: number;
        /** CBaseEntity/m_hDamageFilter — Another entity, or null when it points at nothing. Read-only. */
        readonly damageFilter: Entity<EntityRaw> | null;
        /** CBaseEntity/m_iszDamageFilterName — Read-only, as every string field is. */
        readonly damageFilterName: string;
        /** CBaseEntity/m_bDisableLowViolence */
        disableLowViolence: boolean;
        /** CBaseEntity/m_bDisabledContextThinks */
        disabledContextThinks: boolean;
        /** CBaseEntity/m_iEFlags */
        eFlags: number;
        /** CBaseEntity/m_hEffectEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly effectEntity: Entity<EntityRaw> | null;
        /** CBaseEntity/m_fEffects */
        effects: number;
        /** CBaseEntity/m_flElasticity */
        elasticity: number;
        /** CBaseEntity/m_fFlags */
        flags: number;
        /** CSceneEntity/m_flForceClientTime */
        forceClientTime: number;
        /** CSceneEntity/m_flFrameTime */
        frameTime: number;
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
        /** CBaseEntity/m_hGroundEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly groundEntity: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hTarget1 — Another entity, or null when it points at nothing. Read-only. */
        readonly hTarget1: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hTarget2 — Another entity, or null when it points at nothing. Read-only. */
        readonly hTarget2: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hTarget3 — Another entity, or null when it points at nothing. Read-only. */
        readonly hTarget3: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hTarget4 — Another entity, or null when it points at nothing. Read-only. */
        readonly hTarget4: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hTarget5 — Another entity, or null when it points at nothing. Read-only. */
        readonly hTarget5: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hTarget6 — Another entity, or null when it points at nothing. Read-only. */
        readonly hTarget6: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hTarget7 — Another entity, or null when it points at nothing. Read-only. */
        readonly hTarget7: Entity<EntityRaw> | null;
        /** CSceneEntity/m_hTarget8 — Another entity, or null when it points at nothing. Read-only. */
        readonly hTarget8: Entity<EntityRaw> | null;
        /** CInstancedSceneEntity/m_bHadOwner */
        hadOwner: boolean;
        /** CBaseEntity/m_iHealth */
        health: number;
        /** CBaseEntity/m_iInitialTeamNum */
        initialTeamNum: number;
        /** CBaseEntity/m_ubInterpolationFrame */
        interpolationFrame: number;
        /** CSceneEntity/m_nInterruptCount */
        interruptCount: number;
        /** CSceneEntity/m_hInterruptScene — Another entity, or null when it points at nothing. Read-only. */
        readonly interruptScene: Entity<EntityRaw> | null;
        /** CSceneEntity/m_bInterruptSceneFinished */
        interruptSceneFinished: boolean;
        /** CSceneEntity/m_bInterrupted */
        interrupted: boolean;
        /** CSceneEntity/m_bInterruptedActorsScenes */
        interruptedActorsScenes: boolean;
        /** CInstancedSceneEntity/m_bIsBackground */
        isBackground: boolean;
        /** CSceneEntity/m_bIsPlayingBack */
        isPlayingBack: boolean;
        /** CSceneEntity/m_iszTarget1 — Read-only, as every string field is. */
        readonly iszTarget1: string;
        /** CSceneEntity/m_iszTarget2 — Read-only, as every string field is. */
        readonly iszTarget2: string;
        /** CSceneEntity/m_iszTarget3 — Read-only, as every string field is. */
        readonly iszTarget3: string;
        /** CSceneEntity/m_iszTarget4 — Read-only, as every string field is. */
        readonly iszTarget4: string;
        /** CSceneEntity/m_iszTarget5 — Read-only, as every string field is. */
        readonly iszTarget5: string;
        /** CSceneEntity/m_iszTarget6 — Read-only, as every string field is. */
        readonly iszTarget6: string;
        /** CSceneEntity/m_iszTarget7 — Read-only, as every string field is. */
        readonly iszTarget7: string;
        /** CSceneEntity/m_iszTarget8 — Read-only, as every string field is. */
        readonly iszTarget8: string;
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
        /** CSceneEntity/m_hLocatorOrigin — Another entity, or null when it points at nothing. Read-only. */
        readonly locatorOrigin: Entity<EntityRaw> | null;
        /** CBaseEntity/m_iMaxHealth */
        maxHealth: number;
        /** CBaseEntity/m_MoveCollide — A MoveCollide_t. */
        moveCollide: number;
        /** CBaseEntity/m_flMoveDoneTime */
        moveDoneTime: number;
        /** CBaseEntity/m_MoveType — A MoveType_t. */
        moveType: number;
        /** CSceneEntity/m_bMultiplayer */
        multiplayer: boolean;
        /** CBaseEntity/m_flNavIgnoreUntilTime */
        navIgnoreUntilTime: number;
        /** CBaseEntity/m_bNetworkQuantizeOriginAndAngles */
        networkQuantizeOriginAndAngles: boolean;
        /** CBaseEntity/m_nNextThinkTick */
        nextThinkTick: number;
        /** CInstancedSceneEntity/m_hOwner — Another entity, or null when it points at nothing. Read-only. */
        readonly owner: Entity<EntityRaw> | null;
        /** CBaseEntity/m_hOwnerEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly ownerEntity: Entity<EntityRaw> | null;
        /** CSceneEntity/m_bPauseAtNextInterrupt */
        pauseAtNextInterrupt: boolean;
        /** CSceneEntity/m_bPaused */
        paused: boolean;
        /** CSceneEntity/m_bPausedViaInput */
        pausedViaInput: boolean;
        /** CSceneEntity/m_fPitch */
        pitch: number;
        /** CBaseEntity/m_nPlatformType — A EntityPlatformTypes_t. */
        platformType: number;
        /** CSceneEntity/m_iPlayerDeathBehavior — A SceneOnPlayerDeath_t. */
        playerDeathBehavior: number;
        /** CInstancedSceneEntity/m_flPostSpeakDelay */
        postSpeakDelay: number;
        /** CInstancedSceneEntity/m_flPreDelay */
        preDelay: number;
        /** CBaseEntity/m_nPreviouslySetMoveType — A MoveType_t. */
        previouslySetMoveType: number;
        /** CEntityInstance/m_iszPrivateVScripts — Read-only, as every string field is. */
        readonly privateVScripts: string;
        /** CBaseEntity/m_nPushEnumCount */
        pushEnumCount: number;
        /** CInstancedSceneEntity/m_bRemoveOnCompletion */
        removeOnCompletion: boolean;
        /** CBaseEntity/m_iszResponseContext — Read-only, as every string field is. */
        readonly responseContext: string;
        /** CBaseEntity/m_bRestoreInHierarchy */
        restoreInHierarchy: boolean;
        /** CSceneEntity/m_bRestoring */
        restoring: boolean;
        /** CSceneEntity/m_iszSceneFile — Read-only, as every string field is. */
        readonly sceneFile: string;
        /** CSceneEntity/m_bSceneFinished */
        sceneFinished: boolean;
        /** CSceneEntity/m_bSceneMissing */
        sceneMissing: boolean;
        /** CSceneEntity/m_nSceneStringIndex */
        sceneStringIndex: number;
        /** CBaseEntity/m_iSentToClients */
        sentToClients: number;
        /** CSceneEntity/m_iszSequenceName — Read-only, as every string field is. */
        readonly sequenceName: string;
        /** CBaseEntity/m_nSimulationTick */
        simulationTick: number;
        /** CBaseEntity/m_flSimulationTime */
        simulationTime: number;
        /** CBaseEntity/m_nSlimeTouch */
        slimeTouch: number;
        /** CSceneEntity/m_iszSoundName — Read-only, as every string field is. */
        readonly soundName: string;
        /** CBaseEntity/m_spawnflags */
        spawnflags: number;
        /** CSceneEntity/m_nSpeechPriority */
        speechPriority: number;
        /** CBaseEntity/m_nTakeDamageFlags — A TakeDamageFlags_t. */
        takeDamageFlags: number;
        /** CBaseEntity/m_bTakesDamage */
        takesDamage: boolean;
        /** CInstancedSceneEntity/m_hTarget — Another entity, or null when it points at nothing. Read-only. */
        readonly target: Entity<EntityRaw> | null;
        /** CSceneEntity/m_sTargetAttachment — Read-only, as every string field is. */
        readonly targetAttachment: string;
        /** CBaseEntity/m_iTeamNum */
        teamNum: number;
        /** CBaseEntity/m_flTimeScale */
        timeScale: number;
        /** CBaseEntity/m_sUniqueHammerID — Read-only, as every string field is. */
        readonly uniqueHammerID: string;
        /** CBaseEntity/m_flVPhysicsUpdateLocalTime */
        vPhysicsUpdateLocalTime: number;
        /** CSceneEntity/m_bWaitingForActor */
        waitingForActor: boolean;
        /** CSceneEntity/m_bWaitingForInterrupt */
        waitingForInterrupt: boolean;
        /** CBaseEntity/m_flWaterLevel */
        waterLevel: number;
        /** CBaseEntity/m_nWaterTouch */
        waterTouch: number;
        /** CBaseEntity/m_nWaterType */
        waterType: number;
    }

    /** The fields a CItem adds to CBaseAnimGraphRaw. */
    interface CItemRaw extends CBaseAnimGraphRaw {
        /** CItem/m_bActivateWhenAtRest */
        activateWhenAtRest: boolean;
        /** CItem/m_bPhysStartAsleep */
        physStartAsleep: boolean;
    }

    /** The fields a CItemSoda adds to CBaseAnimGraphRaw. */
    interface CItemSodaRaw extends CBaseAnimGraphRaw {
    }

    /** The fields a CLightDirectionalEntity adds to CLightEntityRaw. */
    interface CLightDirectionalEntityRaw extends CLightEntityRaw {
    }

    /** The fields a CLightOrthoEntity adds to CLightEntityRaw. */
    interface CLightOrthoEntityRaw extends CLightEntityRaw {
    }

    /** The fields a CLightSpotEntity adds to CLightEntityRaw. */
    interface CLightSpotEntityRaw extends CLightEntityRaw {
    }

    /** The fields a CLogicAchievement adds to CLogicalEntityRaw. */
    interface CLogicAchievementRaw extends CLogicalEntityRaw {
        /** CLogicAchievement/m_iszAchievementEventID — Read-only, as every string field is. */
        readonly achievementEventID: string;
        /** CLogicAchievement/m_bDisabled */
        disabled: boolean;
    }

    /** The fields a CLogicActivityEvent adds to CLogicalEntityRaw. */
    interface CLogicActivityEventRaw extends CLogicalEntityRaw {
        /** CLogicActivityEvent/m_flDuration */
        duration: number;
        /** CLogicActivityEvent/m_nEventType */
        eventType: number;
        /** CLogicActivityEvent/m_hSource — Another entity, or null when it points at nothing. Read-only. */
        readonly source: Entity<EntityRaw> | null;
        /** CLogicActivityEvent/m_iszSourceEntityName — Read-only, as every string field is. */
        readonly sourceEntityName: string;
    }

    /** The fields a CLogicAutosave adds to CLogicalEntityRaw. */
    interface CLogicAutosaveRaw extends CLogicalEntityRaw {
        /** CLogicAutosave/m_bForceNewLevelUnit */
        forceNewLevelUnit: boolean;
        /** CLogicAutosave/m_minHitPoints */
        minHitPoints: number;
        /** CLogicAutosave/m_minHitPointsToCommit */
        minHitPointsToCommit: number;
    }

    /** The fields a CLogicBranch adds to CLogicalEntityRaw. */
    interface CLogicBranchRaw extends CLogicalEntityRaw {
        /** CLogicBranch/m_bInValue */
        inValue: boolean;
    }

    /** The fields a CLogicBranchList adds to CLogicalEntityRaw. */
    interface CLogicBranchListRaw extends CLogicalEntityRaw {
    }

    /** The fields a CLogicCase adds to CLogicalEntityRaw. */
    interface CLogicCaseRaw extends CLogicalEntityRaw {
        /** CLogicCase/m_nLastShuffleCase */
        lastShuffleCase: number;
        /** CLogicCase/m_nShuffleCases */
        shuffleCases: number;
    }

    /** The fields a CLogicCollisionPair adds to CLogicalEntityRaw. */
    interface CLogicCollisionPairRaw extends CLogicalEntityRaw {
        /** CLogicCollisionPair/m_allowMissing */
        allowMissing: boolean;
        /** CLogicCollisionPair/m_disabled */
        disabled: boolean;
        /** CLogicCollisionPair/m_includeHierarchy */
        includeHierarchy: boolean;
        /** CLogicCollisionPair/m_nameAttach1 — Read-only, as every string field is. */
        readonly nameAttach1: string;
        /** CLogicCollisionPair/m_nameAttach2 — Read-only, as every string field is. */
        readonly nameAttach2: string;
        /** CLogicCollisionPair/m_succeeded */
        succeeded: boolean;
        /** CLogicCollisionPair/m_supportMultipleEntitiesWithSameName */
        supportMultipleEntitiesWithSameName: boolean;
    }

    /** The fields a CLogicCompare adds to CLogicalEntityRaw. */
    interface CLogicCompareRaw extends CLogicalEntityRaw {
        /** CLogicCompare/m_flCompareValue */
        compareValue: number;
        /** CLogicCompare/m_flInValue */
        inValue: number;
    }

    /** The fields a CLogicDistanceAutosave adds to CLogicalEntityRaw. */
    interface CLogicDistanceAutosaveRaw extends CLogicalEntityRaw {
        /** CLogicDistanceAutosave/m_bCheckCough */
        checkCough: boolean;
        /** CLogicDistanceAutosave/m_flDangerousTime */
        dangerousTime: number;
        /** CLogicDistanceAutosave/m_flDistanceToPlayer */
        distanceToPlayer: number;
        /** CLogicDistanceAutosave/m_bForceNewLevelUnit */
        forceNewLevelUnit: boolean;
        /** CLogicDistanceAutosave/m_iszTargetEntity — Read-only, as every string field is. */
        readonly targetEntity: string;
        /** CLogicDistanceAutosave/m_bThinkDangerous */
        thinkDangerous: boolean;
    }

    /** The fields a CLogicDistanceCheck adds to CLogicalEntityRaw. */
    interface CLogicDistanceCheckRaw extends CLogicalEntityRaw {
        /** CLogicDistanceCheck/m_iszEntityA — Read-only, as every string field is. */
        readonly entityA: string;
        /** CLogicDistanceCheck/m_iszEntityB — Read-only, as every string field is. */
        readonly entityB: string;
        /** CLogicDistanceCheck/m_flZone1Distance */
        zone1Distance: number;
        /** CLogicDistanceCheck/m_flZone2Distance */
        zone2Distance: number;
    }

    /** The fields a CLogicEventListener adds to CLogicalEntityRaw. */
    interface CLogicEventListenerRaw extends CLogicalEntityRaw {
        /** CLogicEventListener/m_bIsEnabled */
        isEnabled: boolean;
        /** CLogicEventListener/m_strEventName — Read-only, as every string field is. */
        readonly strEventName: string;
        /** CLogicEventListener/m_nTeam */
        team: number;
    }

    /** The fields a CLogicGameEvent adds to CLogicalEntityRaw. */
    interface CLogicGameEventRaw extends CLogicalEntityRaw {
        /** CLogicGameEvent/m_iszEventName — Read-only, as every string field is. */
        readonly eventName: string;
    }

    /** The fields a CLogicGameEventListener adds to CLogicalEntityRaw. */
    interface CLogicGameEventListenerRaw extends CLogicalEntityRaw {
        /** CLogicGameEventListener/m_bEnabled */
        enabled: boolean;
        /** CLogicGameEventListener/m_iszGameEventItem — Read-only, as every string field is. */
        readonly gameEventItem: string;
        /** CLogicGameEventListener/m_iszGameEventName — Read-only, as every string field is. */
        readonly gameEventName: string;
        /** CLogicGameEventListener/m_bStartDisabled */
        startDisabled: boolean;
    }

    /** The fields a CLogicLineToEntity adds to CLogicalEntityRaw. */
    interface CLogicLineToEntityRaw extends CLogicalEntityRaw {
        /** CLogicLineToEntity/m_EndEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly endEntity: Entity<EntityRaw> | null;
        /** CLogicLineToEntity/m_SourceName — Read-only, as every string field is. */
        readonly sourceName: string;
        /** CLogicLineToEntity/m_StartEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly startEntity: Entity<EntityRaw> | null;
    }

    /** Every field a CLogicMeasureMovement has, by name. Flattened: it reuses a base field's name for a different type. */
    interface CLogicMeasureMovementRaw {
        /** CBaseEntity/m_flActualGravityScale */
        actualGravityScale: number;
        /** CBaseEntity/m_nActualMoveType — A MoveType_t. */
        actualMoveType: number;
        /** CBaseEntity/m_flAnimTime */
        animTime: number;
        /** CBaseEntity/m_bAnimatedEveryTick */
        animatedEveryTick: boolean;
        /** CBaseEntity/m_pBlocker — Another entity, or null when it points at nothing. Read-only. */
        readonly blocker: Entity<EntityRaw> | null;
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
        /** CBaseEntity/m_hDamageFilter — Another entity, or null when it points at nothing. Read-only. */
        readonly damageFilter: Entity<EntityRaw> | null;
        /** CBaseEntity/m_iszDamageFilterName — Read-only, as every string field is. */
        readonly damageFilterName: string;
        /** CBaseEntity/m_bDisableLowViolence */
        disableLowViolence: boolean;
        /** CBaseEntity/m_bDisabledContextThinks */
        disabledContextThinks: boolean;
        /** CBaseEntity/m_iEFlags */
        eFlags: number;
        /** CBaseEntity/m_hEffectEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly effectEntity: Entity<EntityRaw> | null;
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
        /** CBaseEntity/m_hGroundEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly groundEntity: Entity<EntityRaw> | null;
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
        /** CLogicMeasureMovement/m_hMeasureReference — Another entity, or null when it points at nothing. Read-only. */
        readonly measureReference: Entity<EntityRaw> | null;
        /** CLogicMeasureMovement/m_hMeasureTarget — Another entity, or null when it points at nothing. Read-only. */
        readonly measureTarget: Entity<EntityRaw> | null;
        /** CLogicMeasureMovement/m_nMeasureType */
        measureType: number;
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
        /** CBaseEntity/m_hOwnerEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly ownerEntity: Entity<EntityRaw> | null;
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
        /** CLogicMeasureMovement/m_flScale */
        scale: number;
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
        /** CLogicMeasureMovement/m_strMeasureReference — Read-only, as every string field is. */
        readonly strMeasureReference: string;
        /** CLogicMeasureMovement/m_strMeasureTarget — Read-only, as every string field is. */
        readonly strMeasureTarget: string;
        /** CLogicMeasureMovement/m_strTargetReference — Read-only, as every string field is. */
        readonly strTargetReference: string;
        /** CBaseEntity/m_nTakeDamageFlags — A TakeDamageFlags_t. */
        takeDamageFlags: number;
        /** CBaseEntity/m_bTakesDamage */
        takesDamage: boolean;
        /** CLogicMeasureMovement/m_hTarget — Another entity, or null when it points at nothing. Read-only. */
        readonly target: Entity<EntityRaw> | null;
        /** CLogicMeasureMovement/m_hTargetReference — Another entity, or null when it points at nothing. Read-only. */
        readonly targetReference: Entity<EntityRaw> | null;
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

    /** The fields a CLogicNPCCounterOBB adds to CLogicNPCCounterAABBRaw. */
    interface CLogicNPCCounterOBBRaw extends CLogicNPCCounterAABBRaw {
    }

    /** The fields a CLogicNavigation adds to CLogicalEntityRaw. */
    interface CLogicNavigationRaw extends CLogicalEntityRaw {
        /** CLogicNavigation/m_isOn */
        isOn: boolean;
        /** CLogicNavigation/m_navProperty — A navproperties_t. */
        navProperty: number;
    }

    /** The fields a CLogicPlayerProxy adds to CLogicalEntityRaw. */
    interface CLogicPlayerProxyRaw extends CLogicalEntityRaw {
        /** CLogicPlayerProxy/m_hPlayer — Another entity, or null when it points at nothing. Read-only. */
        readonly player: Entity<EntityRaw> | null;
    }

    /** The fields a CLogicRelay adds to CLogicalEntityRaw. */
    interface CLogicRelayRaw extends CLogicalEntityRaw {
        /** CLogicRelay/m_bDisabled */
        disabled: boolean;
        /** CLogicRelay/m_bFastRetrigger */
        fastRetrigger: boolean;
        /** CLogicRelay/m_bPassthoughCaller */
        passthoughCaller: boolean;
        /** CLogicRelay/m_bTriggerOnce */
        triggerOnce: boolean;
        /** CLogicRelay/m_bWaitForRefire */
        waitForRefire: boolean;
    }

    /** The fields a CMapSharedEnvironment adds to CLogicalEntityRaw. */
    interface CMapSharedEnvironmentRaw extends CLogicalEntityRaw {
        /** CMapSharedEnvironment/m_targetMapName — Read-only, as every string field is. */
        readonly targetMapName: string;
    }

    /** The fields a CMarkupVolumeTagged adds to CMarkupVolumeRaw. */
    interface CMarkupVolumeTaggedRaw extends CMarkupVolumeRaw {
        /** CMarkupVolumeTagged/m_bGroupByPrefab */
        groupByPrefab: boolean;
        /** CMarkupVolumeTagged/m_bGroupByVolume */
        groupByVolume: boolean;
        /** CMarkupVolumeTagged/m_bGroupOtherGroups */
        groupOtherGroups: boolean;
        /** CMarkupVolumeTagged/m_bIsGroup */
        isGroup: boolean;
        /** CMarkupVolumeTagged/m_bIsInGroup */
        isInGroup: boolean;
    }

    /** The fields a CMathColorBlend adds to CLogicalEntityRaw. */
    interface CMathColorBlendRaw extends CLogicalEntityRaw {
        /** CMathColorBlend/m_flInMax */
        inMax: number;
        /** CMathColorBlend/m_flInMin */
        inMin: number;
    }

    /** The fields a CMathCounter adds to CLogicalEntityRaw. */
    interface CMathCounterRaw extends CLogicalEntityRaw {
        /** CMathCounter/m_bDisabled */
        disabled: boolean;
        /** CMathCounter/m_bHitMax */
        hitMax: boolean;
        /** CMathCounter/m_bHitMin */
        hitMin: boolean;
        /** CMathCounter/m_flMax */
        max: number;
        /** CMathCounter/m_flMin */
        min: number;
    }

    /** The fields a CMathRemap adds to CLogicalEntityRaw. */
    interface CMathRemapRaw extends CLogicalEntityRaw {
        /** CMathRemap/m_bEnabled */
        enabled: boolean;
        /** CMathRemap/m_flInMax */
        inMax: number;
        /** CMathRemap/m_flInMin */
        inMin: number;
        /** CMathRemap/m_flOldInValue */
        oldInValue: number;
        /** CMathRemap/m_flOut1 */
        out1: number;
        /** CMathRemap/m_flOut2 */
        out2: number;
    }

    /** The fields a CMoverPathNode adds to CPathNodeRaw. */
    interface CMoverPathNodeRaw extends CPathNodeRaw {
    }

    /** The fields a CMultiLightProxy adds to CLogicalEntityRaw. */
    interface CMultiLightProxyRaw extends CLogicalEntityRaw {
        /** CMultiLightProxy/m_flBrightnessDelta */
        brightnessDelta: number;
        /** CMultiLightProxy/m_flCurrentBrightnessMultiplier */
        currentBrightnessMultiplier: number;
        /** CMultiLightProxy/m_iszLightClassFilter — Read-only, as every string field is. */
        readonly lightClassFilter: string;
        /** CMultiLightProxy/m_iszLightNameFilter — Read-only, as every string field is. */
        readonly lightNameFilter: string;
        /** CMultiLightProxy/m_flLightRadiusFilter */
        lightRadiusFilter: number;
        /** CMultiLightProxy/m_bPerformScreenFade */
        performScreenFade: boolean;
        /** CMultiLightProxy/m_flTargetBrightnessMultiplier */
        targetBrightnessMultiplier: number;
    }

    /** The fields a CMultiSource adds to CLogicalEntityRaw. */
    interface CMultiSourceRaw extends CLogicalEntityRaw {
        /** CMultiSource/m_globalstate — Read-only, as every string field is. */
        readonly globalstate: string;
        /** CMultiSource/m_iTotal */
        total: number;
    }

    /** The fields a COmniLight adds to CBarnLightRaw. */
    interface COmniLightRaw extends CBarnLightRaw {
        /** COmniLight/m_flInnerAngle */
        innerAngle: number;
        /** COmniLight/m_flOuterAngle */
        outerAngle: number;
        /** COmniLight/m_bShowLight */
        showLight: boolean;
    }

    /** The fields a CPathCornerCrash adds to CPathCornerRaw. */
    interface CPathCornerCrashRaw extends CPathCornerRaw {
    }

    /** The fields a CPathKeyFrame adds to CLogicalEntityRaw. */
    interface CPathKeyFrameRaw extends CLogicalEntityRaw {
        /** CPathKeyFrame/m_iNextKey — Read-only, as every string field is. */
        readonly iNextKey: string;
        /** CPathKeyFrame/m_flMoveSpeed */
        moveSpeed: number;
        /** CPathKeyFrame/m_flNextTime */
        nextTime: number;
        /** CPathKeyFrame/m_pNextKey — Another entity, or null when it points at nothing. Read-only. */
        readonly pNextKey: Entity<EntityRaw> | null;
        /** CPathKeyFrame/m_pPrevKey — Another entity, or null when it points at nothing. Read-only. */
        readonly prevKey: Entity<EntityRaw> | null;
    }

    /** The fields a CPathMover adds to CPathWithDynamicNodesRaw. */
    interface CPathMoverRaw extends CPathWithDynamicNodesRaw {
        /** CPathMover/m_hMoverRouter — Another entity, or null when it points at nothing. Read-only. */
        readonly moverRouter: Entity<EntityRaw> | null;
        /** CPathMover/m_iszMoverRouterName — Read-only, as every string field is. */
        readonly moverRouterName: string;
        /** CPathMover/m_iszMoverSpawnerName — Read-only, as every string field is. */
        readonly moverSpawnerName: string;
        /** CPathMover/m_flSampleSpacing */
        sampleSpacing: number;
    }

    /** The fields a CPathMoverEntitySpawner adds to CLogicalEntityRaw. */
    interface CPathMoverEntitySpawnerRaw extends CLogicalEntityRaw {
        /** CPathMoverEntitySpawner/m_bDestroyMoverOnArrivedAtEnd */
        destroyMoverOnArrivedAtEnd: boolean;
        /** CPathMoverEntitySpawner/m_bEnabled */
        enabled: boolean;
        /** CPathMoverEntitySpawner/m_flLastSpawnTime */
        lastSpawnTime: number;
        /** CPathMoverEntitySpawner/m_nMaxActive */
        maxActive: number;
        /** CPathMoverEntitySpawner/m_hPathMover — Another entity, or null when it points at nothing. Read-only. */
        readonly pathMover: Entity<EntityRaw> | null;
        /** CPathMoverEntitySpawner/m_iszPathMoverName — Read-only, as every string field is. */
        readonly pathMoverName: string;
        /** CPathMoverEntitySpawner/m_bPrepopulateOnSpawn */
        prepopulateOnSpawn: boolean;
        /** CPathMoverEntitySpawner/m_flSpawnFrequencyDistToNearestMover */
        spawnFrequencyDistToNearestMover: number;
        /** CPathMoverEntitySpawner/m_flSpawnFrequencySeconds */
        spawnFrequencySeconds: number;
        /** CPathMoverEntitySpawner/m_nSpawnIndex */
        spawnIndex: number;
        /** CPathMoverEntitySpawner/m_nSpawnNum */
        spawnNum: number;
    }

    /** The fields a CPhysBox adds to CBreakableRaw. */
    interface CPhysBoxRaw extends CBreakableRaw {
        /** CPhysBox/m_iszCollisionGroup — Read-only, as every string field is. */
        readonly collisionGroup: string;
        /** CPhysBox/m_damageToEnableMotion */
        damageToEnableMotion: number;
        /** CPhysBox/m_damageType */
        damageType: number;
        /** CPhysBox/m_bEnableUseOutput */
        enableUseOutput: boolean;
        /** CPhysBox/m_flForceToEnableMotion */
        forceToEnableMotion: number;
        /** CPhysBox/m_nHoverPoseFlags — A HoverPoseFlags_t. */
        hoverPoseFlags: number;
        /** CPhysBox/m_iszInteractsAs — Read-only, as every string field is. */
        readonly interactsAs: string;
        /** CPhysBox/m_iszInteractsExclude — Read-only, as every string field is. */
        readonly interactsExclude: string;
        /** CPhysBox/m_iszInteractsWith — Read-only, as every string field is. */
        readonly interactsWith: string;
        /** CPhysBox/m_bNotSolidToWorld */
        notSolidToWorld: boolean;
        /** CPhysBox/m_flTouchOutputPerEntityDelay */
        touchOutputPerEntityDelay: number;
    }

    /** The fields a CPhysConstraint adds to CLogicalEntityRaw. */
    interface CPhysConstraintRaw extends CLogicalEntityRaw {
        /** CPhysConstraint/m_hAttach1 — Another entity, or null when it points at nothing. Read-only. */
        readonly attach1: Entity<EntityRaw> | null;
        /** CPhysConstraint/m_hAttach2 — Another entity, or null when it points at nothing. Read-only. */
        readonly attach2: Entity<EntityRaw> | null;
        /** CPhysConstraint/m_breakSound — Read-only, as every string field is. */
        readonly breakSound: string;
        /** CPhysConstraint/m_forceLimit */
        forceLimit: number;
        /** CPhysConstraint/m_minTeleportDistance */
        minTeleportDistance: number;
        /** CPhysConstraint/m_nameAttach1 — Read-only, as every string field is. */
        readonly nameAttach1: string;
        /** CPhysConstraint/m_nameAttach2 — Read-only, as every string field is. */
        readonly nameAttach2: string;
        /** CPhysConstraint/m_nameAttachment1 — Read-only, as every string field is. */
        readonly nameAttachment1: string;
        /** CPhysConstraint/m_nameAttachment2 — Read-only, as every string field is. */
        readonly nameAttachment2: string;
        /** CPhysConstraint/m_bSnapObjectPositions */
        snapObjectPositions: boolean;
        /** CPhysConstraint/m_torqueLimit */
        torqueLimit: number;
        /** CPhysConstraint/m_bTreatEntity1AsInfiniteMass */
        treatEntity1AsInfiniteMass: boolean;
    }

    /** The fields a CPhysMagnet adds to CBaseAnimGraphRaw. */
    interface CPhysMagnetRaw extends CBaseAnimGraphRaw {
        /** CPhysMagnet/m_bActive */
        active: boolean;
        /** CPhysMagnet/m_forceLimit */
        forceLimit: number;
        /** CPhysMagnet/m_bHasHitSomething */
        hasHitSomething: boolean;
        /** CPhysMagnet/m_massScale */
        massScale: number;
        /** CPhysMagnet/m_iMaxObjectsAttached */
        maxObjectsAttached: number;
        /** CPhysMagnet/m_flNextSuckTime */
        nextSuckTime: number;
        /** CPhysMagnet/m_flRadius */
        radius: number;
        /** CPhysMagnet/m_torqueLimit */
        torqueLimit: number;
        /** CPhysMagnet/m_flTotalMass */
        totalMass: number;
    }

    /** The fields a CPhysMotor adds to CLogicalEntityRaw. */
    interface CPhysMotorRaw extends CLogicalEntityRaw {
        /** CPhysMotor/m_additionalAcceleration */
        additionalAcceleration: number;
        /** CPhysMotor/m_hAnchorObject — Another entity, or null when it points at nothing. Read-only. */
        readonly anchorObject: Entity<EntityRaw> | null;
        /** CPhysMotor/m_angularAcceleration */
        angularAcceleration: number;
        /** CPhysMotor/m_hAttachedObject — Another entity, or null when it points at nothing. Read-only. */
        readonly attachedObject: Entity<EntityRaw> | null;
        /** CPhysMotor/m_flMotorFriction */
        motorFriction: number;
        /** CPhysMotor/m_nameAnchor — Read-only, as every string field is. */
        readonly nameAnchor: string;
        /** CPhysMotor/m_nameAttach — Read-only, as every string field is. */
        readonly nameAttach: string;
        /** CPhysMotor/m_flSpeedWhenSpinUpOrSpinDownStarted */
        speedWhenSpinUpOrSpinDownStarted: number;
        /** CPhysMotor/m_spinDown */
        spinDown: number;
        /** CPhysMotor/m_spinUp */
        spinUp: number;
        /** CPhysMotor/m_flTargetSpeed */
        targetSpeed: number;
        /** CPhysMotor/m_flTorqueScale */
        torqueScale: number;
    }

    /** The fields a CPhysThruster adds to CPhysForceRaw. */
    interface CPhysThrusterRaw extends CPhysForceRaw {
    }

    /** The fields a CPhysTorque adds to CPhysForceRaw. */
    interface CPhysTorqueRaw extends CPhysForceRaw {
    }

    /** The fields a CPhysicsEntitySolver adds to CLogicalEntityRaw. */
    interface CPhysicsEntitySolverRaw extends CLogicalEntityRaw {
        /** CPhysicsEntitySolver/m_cancelTime */
        cancelTime: number;
        /** CPhysicsEntitySolver/m_hMovingEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly movingEntity: Entity<EntityRaw> | null;
        /** CPhysicsEntitySolver/m_hPhysicsBlocker — Another entity, or null when it points at nothing. Read-only. */
        readonly physicsBlocker: Entity<EntityRaw> | null;
        /** CPhysicsEntitySolver/m_separationDuration */
        separationDuration: number;
    }

    /** The fields a CPlantedC4 adds to CBaseAnimGraphRaw. */
    interface CPlantedC4Raw extends CBaseAnimGraphRaw {
        /** CPlantedC4/m_bAbortDetonationBecauseWorldIsFrozen */
        abortDetonationBecauseWorldIsFrozen: boolean;
        /** CPlantedC4/m_bBeingDefused */
        beingDefused: boolean;
        /** CPlantedC4/m_bBombDefused */
        bombDefused: boolean;
        /** CPlantedC4/m_hBombDefuser — Another entity, or null when it points at nothing. Read-only. */
        readonly bombDefuser: Entity<EntityRaw> | null;
        /** CPlantedC4/m_nBombSite */
        bombSite: number;
        /** CPlantedC4/m_bBombTicking */
        bombTicking: boolean;
        /** CPlantedC4/m_flC4Blow */
        c4Blow: number;
        /** CPlantedC4/m_bCannotBeDefused */
        cannotBeDefused: boolean;
        /** CPlantedC4/m_flDefuseCountDown */
        defuseCountDown: number;
        /** CPlantedC4/m_flDefuseLength */
        defuseLength: number;
        /** CPlantedC4/m_bHasExploded */
        hasExploded: boolean;
        /** CPlantedC4/m_fLastDefuseTime */
        lastDefuseTime: number;
        /** CPlantedC4/m_flLastSpinDetectionTime */
        lastSpinDetectionTime: number;
        /** CPlantedC4/m_flNextBotBeepTime */
        nextBotBeepTime: number;
        /** CPlantedC4/m_iProgressBarTime */
        progressBarTime: number;
        /** CPlantedC4/m_nSourceSoundscapeHash */
        sourceSoundscapeHash: number;
        /** CPlantedC4/m_nSpotRules */
        spotRules: number;
        /** CPlantedC4/m_flTimerLength */
        timerLength: number;
        /** CPlantedC4/m_bTrainingPlacedByPlayer */
        trainingPlacedByPlayer: boolean;
        /** CPlantedC4/m_bVoiceAlertFired */
        voiceAlertFired: boolean;
    }

    /** The fields a CPlayerSprayDecal adds to CModelPointEntityRaw. */
    interface CPlayerSprayDecalRaw extends CModelPointEntityRaw {
        /** CPlayerSprayDecal/m_unAccountID */
        accountID: number;
        /** CPlayerSprayDecal/m_flCreationTime */
        creationTime: number;
        /** CPlayerSprayDecal/m_nEntity */
        decalEntity: number;
        /** CPlayerSprayDecal/m_nHitbox */
        hitbox: number;
        /** CPlayerSprayDecal/m_nPlayer */
        player: number;
        /** CPlayerSprayDecal/m_rtGcTime */
        rtGcTime: number;
        /** CPlayerSprayDecal/m_nTintID */
        tintID: number;
        /** CPlayerSprayDecal/m_unTraceID */
        traceID: number;
        /** CPlayerSprayDecal/m_nUniqueID */
        uniqueID: number;
        /** CPlayerSprayDecal/m_nVersion */
        version: number;
    }

    /** The fields a CPointClientUIDialog adds to CBaseClientUIEntityRaw. */
    interface CPointClientUIDialogRaw extends CBaseClientUIEntityRaw {
        /** CPointClientUIDialog/m_hActivator — Another entity, or null when it points at nothing. Read-only. */
        readonly activator: Entity<EntityRaw> | null;
        /** CPointClientUIDialog/m_bStartEnabled */
        startEnabled: boolean;
    }

    /** The fields a CPointClientUIWorldPanel adds to CBaseClientUIEntityRaw. */
    interface CPointClientUIWorldPanelRaw extends CBaseClientUIEntityRaw {
        /** CPointClientUIWorldPanel/m_bAllowInteractionFromAllSceneWorlds */
        allowInteractionFromAllSceneWorlds: boolean;
        /** CPointClientUIWorldPanel/m_flDPI */
        dPI: number;
        /** CPointClientUIWorldPanel/m_flDepthOffset */
        depthOffset: number;
        /** CPointClientUIWorldPanel/m_bDisableMipGen */
        disableMipGen: boolean;
        /** CPointClientUIWorldPanel/m_bExcludeFromSaveGames */
        excludeFromSaveGames: boolean;
        /** CPointClientUIWorldPanel/m_nExplicitImageLayout */
        explicitImageLayout: number;
        /** CPointClientUIWorldPanel/m_bFollowPlayerAcrossTeleport */
        followPlayerAcrossTeleport: boolean;
        /** CPointClientUIWorldPanel/m_bGrabbable */
        grabbable: boolean;
        /** CPointClientUIWorldPanel/m_flHeight */
        height: number;
        /** CPointClientUIWorldPanel/m_unHorizontalAlign */
        horizontalAlign: number;
        /** CPointClientUIWorldPanel/m_bIgnoreInput */
        ignoreInput: boolean;
        /** CPointClientUIWorldPanel/m_bIgnoreParentOrientation */
        ignoreParentOrientation: boolean;
        /** CPointClientUIWorldPanel/m_flInteractDistance */
        interactDistance: number;
        /** CPointClientUIWorldPanel/m_bLit */
        lit: boolean;
        /** CPointClientUIWorldPanel/m_bNoDepth */
        noDepth: boolean;
        /** CPointClientUIWorldPanel/m_bOnlyRenderToTexture */
        onlyRenderToTexture: boolean;
        /** CPointClientUIWorldPanel/m_bOpaque */
        opaque: boolean;
        /** CPointClientUIWorldPanel/m_unOrientation */
        orientation: number;
        /** CPointClientUIWorldPanel/m_unOwnerContext */
        ownerContext: number;
        /** CPointClientUIWorldPanel/m_bRenderBackface */
        renderBackface: boolean;
        /** CPointClientUIWorldPanel/m_bUseOffScreenIndicator */
        useOffScreenIndicator: boolean;
        /** CPointClientUIWorldPanel/m_unVerticalAlign */
        verticalAlign: number;
        /** CPointClientUIWorldPanel/m_bVisibleWhenParentNoDraw */
        visibleWhenParentNoDraw: boolean;
        /** CPointClientUIWorldPanel/m_flWidth */
        width: number;
    }

    /** The fields a CPointCommentaryNode adds to CBaseAnimGraphRaw. */
    interface CPointCommentaryNodeRaw extends CBaseAnimGraphRaw {
        /** CPointCommentaryNode/m_flAbortedPlaybackAt */
        abortedPlaybackAt: number;
        /** CPointCommentaryNode/m_bActive */
        active: boolean;
        /** CPointCommentaryNode/m_iszCommentaryFile — Read-only, as every string field is. */
        readonly commentaryFile: string;
        /** CPointCommentaryNode/m_bDisabled */
        disabled: boolean;
        /** CPointCommentaryNode/m_flFinishedTime */
        finishedTime: number;
        /** CPointCommentaryNode/m_hViewPosition — Another entity, or null when it points at nothing. Read-only. */
        readonly hViewPosition: Entity<EntityRaw> | null;
        /** CPointCommentaryNode/m_hViewTarget — Another entity, or null when it points at nothing. Read-only. */
        readonly hViewTarget: Entity<EntityRaw> | null;
        /** CPointCommentaryNode/m_iszViewPosition — Read-only, as every string field is. */
        readonly iszViewPosition: string;
        /** CPointCommentaryNode/m_iszViewTarget — Read-only, as every string field is. */
        readonly iszViewTarget: string;
        /** CPointCommentaryNode/m_bListenedTo */
        listenedTo: boolean;
        /** CPointCommentaryNode/m_iNodeNumber */
        nodeNumber: number;
        /** CPointCommentaryNode/m_iNodeNumberMax */
        nodeNumberMax: number;
        /** CPointCommentaryNode/m_iszPostCommands — Read-only, as every string field is. */
        readonly postCommands: string;
        /** CPointCommentaryNode/m_iszPreCommands — Read-only, as every string field is. */
        readonly preCommands: string;
        /** CPointCommentaryNode/m_bPreventChangesWhileMoving */
        preventChangesWhileMoving: boolean;
        /** CPointCommentaryNode/m_bPreventMovement */
        preventMovement: boolean;
        /** CPointCommentaryNode/m_iszSpeakers — Read-only, as every string field is. */
        readonly speakers: string;
        /** CPointCommentaryNode/m_flStartTime */
        startTime: number;
        /** CPointCommentaryNode/m_flStartTimeInCommentary */
        startTimeInCommentary: number;
        /** CPointCommentaryNode/m_iszTitle — Read-only, as every string field is. */
        readonly title: string;
        /** CPointCommentaryNode/m_bUnderCrosshair */
        underCrosshair: boolean;
        /** CPointCommentaryNode/m_bUnstoppable */
        unstoppable: boolean;
        /** CPointCommentaryNode/m_hViewPositionMover — Another entity, or null when it points at nothing. Read-only. */
        readonly viewPositionMover: Entity<EntityRaw> | null;
        /** CPointCommentaryNode/m_hViewTargetAngles — Another entity, or null when it points at nothing. Read-only. */
        readonly viewTargetAngles: Entity<EntityRaw> | null;
    }

    /** The fields a CPointPrefab adds to CServerOnlyPointEntityRaw. */
    interface CPointPrefabRaw extends CServerOnlyPointEntityRaw {
        /** CPointPrefab/m_associatedRelayEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly associatedRelayEntity: Entity<EntityRaw> | null;
        /** CPointPrefab/m_associatedRelayTargetName — Read-only, as every string field is. */
        readonly associatedRelayTargetName: string;
        /** CPointPrefab/m_fixupNames */
        fixupNames: boolean;
        /** CPointPrefab/m_forceWorldGroupID — Read-only, as every string field is. */
        readonly forceWorldGroupID: string;
        /** CPointPrefab/m_bLoadDynamic */
        loadDynamic: boolean;
        /** CPointPrefab/m_targetMapName — Read-only, as every string field is. */
        readonly targetMapName: string;
    }

    /** The fields a CPointTeleport adds to CServerOnlyPointEntityRaw. */
    interface CPointTeleportRaw extends CServerOnlyPointEntityRaw {
        /** CPointTeleport/m_bTeleportParentedEntities */
        teleportParentedEntities: boolean;
        /** CPointTeleport/m_bTeleportUseCurrentAngle */
        teleportUseCurrentAngle: boolean;
    }

    /** The fields a CPointTemplate adds to CLogicalEntityRaw. */
    interface CPointTemplateRaw extends CLogicalEntityRaw {
        /** CPointTemplate/m_bAsynchronouslySpawnEntities */
        asynchronouslySpawnEntities: boolean;
        /** CPointTemplate/m_clientOnlyEntityBehavior — A PointTemplateClientOnlyEntityBehavior_t. */
        clientOnlyEntityBehavior: number;
        /** CPointTemplate/m_iszEntityFilterName — Read-only, as every string field is. */
        readonly entityFilterName: string;
        /** CPointTemplate/m_ownerSpawnGroupType — A PointTemplateOwnerSpawnGroupType_t. */
        ownerSpawnGroupType: number;
        /** CPointTemplate/m_iszSource2EntityLumpName — Read-only, as every string field is. */
        readonly source2EntityLumpName: string;
        /** CPointTemplate/m_flTimeoutInterval */
        timeoutInterval: number;
        /** CPointTemplate/m_iszWorldName — Read-only, as every string field is. */
        readonly worldName: string;
    }

    /** The fields a CPointWorldText adds to CModelPointEntityRaw. */
    interface CPointWorldTextRaw extends CModelPointEntityRaw {
        /** CPointWorldText/m_flBackgroundBorderHeight */
        backgroundBorderHeight: number;
        /** CPointWorldText/m_flBackgroundBorderWidth */
        backgroundBorderWidth: number;
        /** CPointWorldText/m_BackgroundMaterialName — Read-only, as every string field is. */
        readonly backgroundMaterialName: string;
        /** CPointWorldText/m_flBackgroundWorldToUV */
        backgroundWorldToUV: number;
        /** CPointWorldText/m_flDepthOffset */
        depthOffset: number;
        /** CPointWorldText/m_bDrawBackground */
        drawBackground: boolean;
        /** CPointWorldText/m_bEnabled */
        enabled: boolean;
        /** CPointWorldText/m_FontName — Read-only, as every string field is. */
        readonly fontName: string;
        /** CPointWorldText/m_flFontSize */
        fontSize: number;
        /** CPointWorldText/m_bFullbright */
        fullbright: boolean;
        /** CPointWorldText/m_nJustifyHorizontal — A PointWorldTextJustifyHorizontal_t. */
        justifyHorizontal: number;
        /** CPointWorldText/m_nJustifyVertical — A PointWorldTextJustifyVertical_t. */
        justifyVertical: number;
        /** CPointWorldText/m_messageText — Read-only, as every string field is. */
        readonly messageText: string;
        /** CPointWorldText/m_nReorientMode — A PointWorldTextReorientMode_t. */
        reorientMode: number;
        /** CPointWorldText/m_flWorldUnitsPerPx */
        worldUnitsPerPx: number;
    }

    /** The fields a CPushable adds to CBreakableRaw. */
    interface CPushableRaw extends CBreakableRaw {
    }

    /** The fields a CRagdollProp adds to CBaseAnimGraphRaw. */
    interface CRagdollPropRaw extends CBaseAnimGraphRaw {
        /** CRagdollProp/m_allAsleep */
        allAsleep: boolean;
        /** CRagdollProp/m_bAllowStretch */
        allowStretch: boolean;
        /** CRagdollProp/m_bAttachedToReferenceFrame */
        attachedToReferenceFrame: boolean;
        /** CRagdollProp/m_flAwakeTime */
        awakeTime: number;
        /** CRagdollProp/m_flBlendWeight */
        blendWeight: number;
        /** CRagdollProp/m_buoyancyScale */
        buoyancyScale: number;
        /** CRagdollProp/m_hDamageEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly damageEntity: Entity<EntityRaw> | null;
        /** CRagdollProp/m_flDefaultFadeScale */
        defaultFadeScale: number;
        /** CRagdollProp/m_flFadeOutStartTime */
        fadeOutStartTime: number;
        /** CRagdollProp/m_flFadeTime */
        fadeTime: number;
        /** CRagdollProp/m_bFirstCollisionAfterLaunch */
        firstCollisionAfterLaunch: boolean;
        /** CRagdollProp/m_bForceNavObstacleCut */
        forceNavObstacleCut: boolean;
        /** CRagdollProp/m_bHasBeenPhysgunned */
        hasBeenPhysgunned: boolean;
        /** CRagdollProp/m_hKiller — Another entity, or null when it points at nothing. Read-only. */
        readonly killer: Entity<EntityRaw> | null;
        /** CRagdollProp/m_flLastOriginChangeTime */
        lastOriginChangeTime: number;
        /** CRagdollProp/m_flLastPhysicsInfluenceTime */
        lastPhysicsInfluenceTime: number;
        /** CRagdollProp/m_lastUpdateTickCount */
        lastUpdateTickCount: number;
        /** CRagdollProp/m_massScale */
        massScale: number;
        /** CRagdollProp/m_nNavObstacleType — A INavObstacleNavObstacleType_t. */
        navObstacleType: number;
        /** CRagdollProp/m_hPhysicsAttacker — Another entity, or null when it points at nothing. Read-only. */
        readonly physicsAttacker: Entity<EntityRaw> | null;
        /** CRagdollProp/m_bShouldDeleteActivationRecord */
        shouldDeleteActivationRecord: boolean;
        /** CRagdollProp/m_bStartDisabled */
        startDisabled: boolean;
        /** CRagdollProp/m_strOriginClassName — Read-only, as every string field is. */
        readonly strOriginClassName: string;
        /** CRagdollProp/m_strSourceClassName — Read-only, as every string field is. */
        readonly strSourceClassName: string;
        /** CRagdollProp/m_bUpdateNavWhenMoving */
        updateNavWhenMoving: boolean;
    }

    /** The fields a CRectLight adds to CBarnLightRaw. */
    interface CRectLightRaw extends CBarnLightRaw {
        /** CRectLight/m_bShowLight */
        showLight: boolean;
    }

    /** The fields a CRevertSaved adds to CModelPointEntityRaw. */
    interface CRevertSavedRaw extends CModelPointEntityRaw {
        /** CRevertSaved/m_Duration */
        duration: number;
        /** CRevertSaved/m_HoldTime */
        holdTime: number;
        /** CRevertSaved/m_loadTime */
        loadTime: number;
    }

    /** The fields a CRopeKeyframeAlias_move_rope adds to CRopeKeyframeRaw. */
    interface CRopeKeyframeAlias_move_ropeRaw extends CRopeKeyframeRaw {
    }

    /** The fields a CRuleBrushEntity adds to CRuleEntityRaw. */
    interface CRuleBrushEntityRaw extends CRuleEntityRaw {
    }

    /** The fields a CRulePointEntity adds to CRuleEntityRaw. */
    interface CRulePointEntityRaw extends CRuleEntityRaw {
        /** CRulePointEntity/m_Score */
        score: number;
    }

    /** The fields a CSceneEntityAlias_logic_choreographed_scene adds to CSceneEntityRaw. */
    interface CSceneEntityAlias_logic_choreographed_sceneRaw extends CSceneEntityRaw {
    }

    /** The fields a CSceneListManager adds to CLogicalEntityRaw. */
    interface CSceneListManagerRaw extends CLogicalEntityRaw {
    }

    /** The fields a CScriptNavBlocker adds to CFuncNavBlockerRaw. */
    interface CScriptNavBlockerRaw extends CFuncNavBlockerRaw {
    }

    /** The fields a CShower adds to CModelPointEntityRaw. */
    interface CShowerRaw extends CModelPointEntityRaw {
        /** CShower/m_flSpeed */
        speed: number;
    }

    /** The fields a CSoundOpvarSetAutoRoomEntity adds to CSoundOpvarSetPointEntityRaw. */
    interface CSoundOpvarSetAutoRoomEntityRaw extends CSoundOpvarSetPointEntityRaw {
        /** CSoundOpvarSetAutoRoomEntity/m_flHeightTolerance */
        heightTolerance: number;
        /** CSoundOpvarSetAutoRoomEntity/m_flSize */
        size: number;
        /** CSoundOpvarSetAutoRoomEntity/m_flSizeSqr */
        sizeSqr: number;
    }

    /** The fields a CSoundOpvarSetBoxEntity adds to CSoundOpvarSetPointEntityRaw. */
    interface CSoundOpvarSetBoxEntityRaw extends CSoundOpvarSetPointEntityRaw {
        /** CSoundOpvarSetBoxEntity/m_nBoxDirection */
        boxDirection: number;
    }

    /** The fields a CSoundOpvarSetPathCornerEntity adds to CSoundOpvarSetPointEntityRaw. */
    interface CSoundOpvarSetPathCornerEntityRaw extends CSoundOpvarSetPointEntityRaw {
        /** CSoundOpvarSetPathCornerEntity/m_flDistMaxSqr */
        distMaxSqr: number;
        /** CSoundOpvarSetPathCornerEntity/m_flDistMinSqr */
        distMinSqr: number;
        /** CSoundOpvarSetPathCornerEntity/m_iszPathCornerEntityName — Read-only, as every string field is. */
        readonly pathCornerEntityName: string;
        /** CSoundOpvarSetPathCornerEntity/m_bUseParentedPath */
        useParentedPath: boolean;
    }

    /** The fields a CSoundStackSave adds to CLogicalEntityRaw. */
    interface CSoundStackSaveRaw extends CLogicalEntityRaw {
        /** CSoundStackSave/m_iszStackName — Read-only, as every string field is. */
        readonly stackName: string;
    }

    /** The fields a CSpriteAlias_env_glow adds to CSpriteRaw. */
    interface CSpriteAlias_env_glowRaw extends CSpriteRaw {
    }

    /** The fields a CSpriteOriented adds to CSpriteRaw. */
    interface CSpriteOrientedRaw extends CSpriteRaw {
    }

    /** The fields a CTestPulseIO adds to CLogicalEntityRaw. */
    interface CTestPulseIORaw extends CLogicalEntityRaw {
        /** CTestPulseIO/m_bAllowEmptyInputs */
        allowEmptyInputs: boolean;
    }

    /** The fields a CTimerEntity adds to CLogicalEntityRaw. */
    interface CTimerEntityRaw extends CLogicalEntityRaw {
        /** CTimerEntity/m_iDisabled */
        disabled: number;
        /** CTimerEntity/m_flInitialDelay */
        initialDelay: number;
        /** CTimerEntity/m_flLowerRandomBound */
        lowerRandomBound: number;
        /** CTimerEntity/m_bPauseAfterFiring */
        pauseAfterFiring: boolean;
        /** CTimerEntity/m_bPaused */
        paused: boolean;
        /** CTimerEntity/m_flRefireTime */
        refireTime: number;
        /** CTimerEntity/m_flRemainingTime */
        remainingTime: number;
        /** CTimerEntity/m_bUpDownState */
        upDownState: boolean;
        /** CTimerEntity/m_flUpperRandomBound */
        upperRandomBound: number;
        /** CTimerEntity/m_iUseRandomTime */
        useRandomTime: number;
    }

    /** The fields a CWaterBullet adds to CBaseAnimGraphRaw. */
    interface CWaterBulletRaw extends CBaseAnimGraphRaw {
    }

    /** The fields a SpawnPoint adds to CServerOnlyPointEntityRaw. */
    interface SpawnPointRaw extends CServerOnlyPointEntityRaw {
        /** SpawnPoint/m_bEnabled */
        enabled: boolean;
        /** SpawnPoint/m_iPriority */
        priority: number;
        /** SpawnPoint/m_nType */
        type: number;
    }

    /** The fields a CBaseCSGrenadeProjectile adds to CBaseGrenadeRaw. */
    interface CBaseCSGrenadeProjectileRaw extends CBaseGrenadeRaw {
        /** CBaseCSGrenadeProjectile/m_nBounces */
        bounces: number;
        /** CBaseCSGrenadeProjectile/m_bDetonationRecorded */
        detonationRecorded: boolean;
        /** CBaseCSGrenadeProjectile/m_nExplodeEffectTickBegin */
        explodeEffectTickBegin: number;
        /** CBaseCSGrenadeProjectile/m_bHasEverHitEnemy */
        hasEverHitEnemy: boolean;
        /** CBaseCSGrenadeProjectile/m_nItemIndex */
        itemIndex: number;
        /** CBaseCSGrenadeProjectile/m_flLastBounceSoundTime */
        lastBounceSoundTime: number;
        /** CBaseCSGrenadeProjectile/m_unOGSExtraFlags */
        oGSExtraFlags: number;
        /** CBaseCSGrenadeProjectile/m_flSpawnTime */
        spawnTime: number;
        /** CBaseCSGrenadeProjectile/m_nTicksAtZeroVelocity */
        ticksAtZeroVelocity: number;
    }

    /** The fields a CBaseMoveBehavior adds to CPathKeyFrameRaw. */
    interface CBaseMoveBehaviorRaw extends CPathKeyFrameRaw {
        /** CBaseMoveBehavior/m_flAnimEndTime */
        animEndTime: number;
        /** CBaseMoveBehavior/m_flAnimStartTime */
        animStartTime: number;
        /** CBaseMoveBehavior/m_flAverageSpeedAcrossFrame */
        averageSpeedAcrossFrame: number;
        /** CBaseMoveBehavior/m_pCurrentKeyFrame — Another entity, or null when it points at nothing. Read-only. */
        readonly currentKeyFrame: Entity<EntityRaw> | null;
        /** CBaseMoveBehavior/m_iDirection */
        direction: number;
        /** CBaseMoveBehavior/m_iPositionInterpolator */
        positionInterpolator: number;
        /** CBaseMoveBehavior/m_pPostKeyFrame — Another entity, or null when it points at nothing. Read-only. */
        readonly postKeyFrame: Entity<EntityRaw> | null;
        /** CBaseMoveBehavior/m_pPreKeyFrame — Another entity, or null when it points at nothing. Read-only. */
        readonly preKeyFrame: Entity<EntityRaw> | null;
        /** CBaseMoveBehavior/m_iRotationInterpolator */
        rotationInterpolator: number;
        /** CBaseMoveBehavior/m_pTargetKeyFrame — Another entity, or null when it points at nothing. Read-only. */
        readonly targetKeyFrame: Entity<EntityRaw> | null;
        /** CBaseMoveBehavior/m_flTimeIntoFrame */
        timeIntoFrame: number;
    }

    /** The fields a CBasePlayerPawn adds to CBaseCombatCharacterRaw. */
    interface CBasePlayerPawnRaw extends CBaseCombatCharacterRaw {
        /** CBasePlayerPawn/m_hController — Another entity, or null when it points at nothing. Read-only. */
        readonly controller: Entity<EntityRaw> | null;
        /** CBasePlayerPawn/m_flDeathTime */
        deathTime: number;
        /** CBasePlayerPawn/m_hDefaultController — Another entity, or null when it points at nothing. Read-only. */
        readonly defaultController: Entity<EntityRaw> | null;
        /** CBasePlayerPawn/m_iHideHUD */
        hideHUD: number;
        /** CBasePlayerPawn/m_fHltvReplayDelay */
        hltvReplayDelay: number;
        /** CBasePlayerPawn/m_fHltvReplayEnd */
        hltvReplayEnd: number;
        /** CBasePlayerPawn/m_fInitHUD */
        initHUD: boolean;
        /** CBasePlayerPawn/m_fNextSuicideTime */
        nextSuicideTime: number;
        /** CBasePlayerPawn/m_fTimeLastHurt */
        timeLastHurt: number;
    }

    /** The fields a CBasePlayerWeapon adds to CEconEntityRaw. */
    interface CBasePlayerWeaponRaw extends CEconEntityRaw {
        /** CBasePlayerWeapon/m_iClip1 */
        clip1: number;
        /** CBasePlayerWeapon/m_iClip2 */
        clip2: number;
        /** CBasePlayerWeapon/m_nNextPrimaryAttackTick */
        nextPrimaryAttackTick: number;
        /** CBasePlayerWeapon/m_flNextPrimaryAttackTickRatio */
        nextPrimaryAttackTickRatio: number;
        /** CBasePlayerWeapon/m_nNextSecondaryAttackTick */
        nextSecondaryAttackTick: number;
        /** CBasePlayerWeapon/m_flNextSecondaryAttackTickRatio */
        nextSecondaryAttackTickRatio: number;
    }

    /** The fields a CBombTarget adds to CBaseTriggerRaw. */
    interface CBombTargetRaw extends CBaseTriggerRaw {
        /** CBombTarget/m_bBombPlantedHere */
        bombPlantedHere: boolean;
        /** CBombTarget/m_nBombSiteDesignation */
        bombSiteDesignation: number;
        /** CBombTarget/m_hInstructorHint — Another entity, or null when it points at nothing. Read-only. */
        readonly instructorHint: Entity<EntityRaw> | null;
        /** CBombTarget/m_bIsBombSiteB */
        isBombSiteB: boolean;
        /** CBombTarget/m_bIsHeistBombTarget */
        isHeistBombTarget: boolean;
        /** CBombTarget/m_szMountTarget — Read-only, as every string field is. */
        readonly mountTarget: string;
    }

    /** The fields a CBreakableProp adds to CBasePropRaw. */
    interface CBreakablePropRaw extends CBasePropRaw {
        /** CBreakableProp/m_BreakableContentsType — A BreakableContentsType_t. */
        breakableContentsType: number;
        /** CBreakableProp/m_hBreaker — Another entity, or null when it points at nothing. Read-only. */
        readonly breaker: Entity<EntityRaw> | null;
        /** CBreakableProp/m_flDefBurstScale */
        defBurstScale: number;
        /** CBreakableProp/m_flDefaultFadeScale */
        defaultFadeScale: number;
        /** CBreakableProp/m_explodeDamage */
        explodeDamage: number;
        /** CBreakableProp/m_explodeRadius */
        explodeRadius: number;
        /** CBreakableProp/m_explosionBuildupSound — Read-only, as every string field is. */
        readonly explosionBuildupSound: string;
        /** CBreakableProp/m_explosionCustomEffect — Read-only, as every string field is. */
        readonly explosionCustomEffect: string;
        /** CBreakableProp/m_explosionCustomSound — Read-only, as every string field is. */
        readonly explosionCustomSound: string;
        /** CBreakableProp/m_explosionDelay */
        explosionDelay: number;
        /** CBreakableProp/m_explosionModifier — Read-only, as every string field is. */
        readonly explosionModifier: string;
        /** CBreakableProp/m_sExplosionType — Read-only, as every string field is. */
        readonly explosionType: string;
        /** CBreakableProp/m_bHasBreakPiecesOrCommands */
        hasBreakPiecesOrCommands: boolean;
        /** CBreakableProp/m_impactEnergyScale */
        impactEnergyScale: number;
        /** CBreakableProp/m_hLastAttacker — Another entity, or null when it points at nothing. Read-only. */
        readonly lastAttacker: Entity<EntityRaw> | null;
        /** CBreakableProp/m_flLastPhysicsInfluenceTime */
        lastPhysicsInfluenceTime: number;
        /** CBreakableProp/m_iMinHealthDmg */
        minHealthDmg: number;
        /** CBreakableProp/m_bOriginalBlockLOS */
        originalBlockLOS: boolean;
        /** CBreakableProp/m_PerformanceMode — A PerformanceMode_t. */
        performanceMode: number;
        /** CBreakableProp/m_hPhysicsAttacker — Another entity, or null when it points at nothing. Read-only. */
        readonly physicsAttacker: Entity<EntityRaw> | null;
        /** CBreakableProp/m_flPressureDelay */
        pressureDelay: number;
        /** CBreakableProp/m_flPreventDamageBeforeTime */
        preventDamageBeforeTime: number;
        /** CBreakableProp/m_iszPuntSound — Read-only, as every string field is. */
        readonly puntSound: string;
        /** CBreakableProp/m_strBreakableContentsParticleOverride — Read-only, as every string field is. */
        readonly strBreakableContentsParticleOverride: string;
        /** CBreakableProp/m_strBreakableContentsPropGroupOverride — Read-only, as every string field is. */
        readonly strBreakableContentsPropGroupOverride: string;
        /** CBreakableProp/m_bUsePuntSound */
        usePuntSound: boolean;
    }

    /** The fields a CBuyZone adds to CBaseTriggerRaw. */
    interface CBuyZoneRaw extends CBaseTriggerRaw {
        /** CBuyZone/m_LegacyTeamNum */
        legacyTeamNum: number;
    }

    /** The fields a CCSGO_WingmanIntroCounterTerroristPosition adds to CCSGO_WingmanIntroCharacterPositionRaw. */
    interface CCSGO_WingmanIntroCounterTerroristPositionRaw extends CCSGO_WingmanIntroCharacterPositionRaw {
    }

    /** The fields a CCSGO_WingmanIntroTerroristPosition adds to CCSGO_WingmanIntroCharacterPositionRaw. */
    interface CCSGO_WingmanIntroTerroristPositionRaw extends CCSGO_WingmanIntroCharacterPositionRaw {
    }

    /** The fields a CChangeLevel adds to CBaseTriggerRaw. */
    interface CChangeLevelRaw extends CBaseTriggerRaw {
        /** CChangeLevel/m_sLandmarkName — Read-only, as every string field is. */
        readonly landmarkName: string;
        /** CChangeLevel/m_sMapName — Read-only, as every string field is. */
        readonly mapName: string;
        /** CChangeLevel/m_bNewChapter */
        newChapter: boolean;
        /** CChangeLevel/m_bNoTouch */
        noTouch: boolean;
        /** CChangeLevel/m_bOnChangeLevelFired */
        onChangeLevelFired: boolean;
        /** CChangeLevel/m_bTouched */
        touched: boolean;
    }

    /** The fields a CColorCorrectionVolume adds to CBaseTriggerRaw. */
    interface CColorCorrectionVolumeRaw extends CBaseTriggerRaw {
        /** CColorCorrectionVolume/m_FadeDuration */
        fadeDuration: number;
        /** CColorCorrectionVolume/m_LastEnterTime */
        lastEnterTime: number;
        /** CColorCorrectionVolume/m_LastEnterWeight */
        lastEnterWeight: number;
        /** CColorCorrectionVolume/m_LastExitTime */
        lastExitTime: number;
        /** CColorCorrectionVolume/m_LastExitWeight */
        lastExitWeight: number;
        /** CColorCorrectionVolume/m_lookupFilename — Read-only, as every string field is. */
        readonly lookupFilename: string;
        /** CColorCorrectionVolume/m_MaxWeight */
        maxWeight: number;
        /** CColorCorrectionVolume/m_Weight */
        weight: number;
    }

    /** The fields a CEconWearable adds to CEconEntityRaw. */
    interface CEconWearableRaw extends CEconEntityRaw {
        /** CEconWearable/m_bAlwaysAllow */
        alwaysAllow: boolean;
        /** CEconWearable/m_nForceSkin */
        forceSkin: number;
    }

    /** The fields a CFilterAttributeInt adds to CBaseFilterRaw. */
    interface CFilterAttributeIntRaw extends CBaseFilterRaw {
        /** CFilterAttributeInt/m_sAttributeName — Read-only, as every string field is. */
        readonly attributeName: string;
    }

    /** The fields a CFilterClass adds to CBaseFilterRaw. */
    interface CFilterClassRaw extends CBaseFilterRaw {
        /** CFilterClass/m_iFilterClass — Read-only, as every string field is. */
        readonly filterClass: string;
    }

    /** The fields a CFilterContext adds to CBaseFilterRaw. */
    interface CFilterContextRaw extends CBaseFilterRaw {
        /** CFilterContext/m_iFilterContext — Read-only, as every string field is. */
        readonly filterContext: string;
    }

    /** The fields a CFilterEnemy adds to CBaseFilterRaw. */
    interface CFilterEnemyRaw extends CBaseFilterRaw {
        /** CFilterEnemy/m_iszEnemyName — Read-only, as every string field is. */
        readonly enemyName: string;
        /** CFilterEnemy/m_nMaxSquadmatesPerEnemy */
        maxSquadmatesPerEnemy: number;
        /** CFilterEnemy/m_flOuterRadius */
        outerRadius: number;
        /** CFilterEnemy/m_iszPlayerName — Read-only, as every string field is. */
        readonly playerName: string;
        /** CFilterEnemy/m_flRadius */
        radius: number;
    }

    /** The fields a CFilterLOS adds to CBaseFilterRaw. */
    interface CFilterLOSRaw extends CBaseFilterRaw {
    }

    /** The fields a CFilterMassGreater adds to CBaseFilterRaw. */
    interface CFilterMassGreaterRaw extends CBaseFilterRaw {
        /** CFilterMassGreater/m_fFilterMass */
        filterMass: number;
    }

    /** The fields a CFilterModel adds to CBaseFilterRaw. */
    interface CFilterModelRaw extends CBaseFilterRaw {
        /** CFilterModel/m_iFilterModel — Read-only, as every string field is. */
        readonly filterModel: string;
    }

    /** The fields a CFilterMultiple adds to CBaseFilterRaw. */
    interface CFilterMultipleRaw extends CBaseFilterRaw {
        /** CFilterMultiple/m_nFilterType — A filter_t. */
        filterType: number;
    }

    /** The fields a CFilterName adds to CBaseFilterRaw. */
    interface CFilterNameRaw extends CBaseFilterRaw {
        /** CFilterName/m_iFilterName — Read-only, as every string field is. */
        readonly filterName: string;
    }

    /** The fields a CFilterProximity adds to CBaseFilterRaw. */
    interface CFilterProximityRaw extends CBaseFilterRaw {
        /** CFilterProximity/m_flRadius */
        radius: number;
    }

    /** The fields a CFilterTeam adds to CBaseFilterRaw. */
    interface CFilterTeamRaw extends CBaseFilterRaw {
        /** CFilterTeam/m_iFilterTeam */
        filterTeam: number;
    }

    /** The fields a CFogTrigger adds to CBaseTriggerRaw. */
    interface CFogTriggerRaw extends CBaseTriggerRaw {
    }

    /** The fields a CFootstepControl adds to CBaseTriggerRaw. */
    interface CFootstepControlRaw extends CBaseTriggerRaw {
        /** CFootstepControl/m_destination — Read-only, as every string field is. */
        readonly destination: string;
        /** CFootstepControl/m_source — Read-only, as every string field is. */
        readonly source: string;
    }

    /** The fields a CFuncMoveLinearAlias_momentary_door adds to CFuncMoveLinearRaw. */
    interface CFuncMoveLinearAlias_momentary_doorRaw extends CFuncMoveLinearRaw {
    }

    /** The fields a CFuncPlat adds to CBasePlatTrainRaw. */
    interface CFuncPlatRaw extends CBasePlatTrainRaw {
        /** CFuncPlat/m_sNoise — Read-only, as every string field is. */
        readonly noise: string;
        /** CFuncPlat/m_flSpeed */
        speed: number;
    }

    /** The fields a CFuncTrain adds to CBasePlatTrainRaw. */
    interface CFuncTrainRaw extends CBasePlatTrainRaw {
        /** CFuncTrain/m_activated */
        activated: boolean;
        /** CFuncTrain/m_flBlockDamage */
        blockDamage: number;
        /** CFuncTrain/m_hCurrentTarget — Another entity, or null when it points at nothing. Read-only. */
        readonly currentTarget: Entity<EntityRaw> | null;
        /** CFuncTrain/m_hEnemy — Another entity, or null when it points at nothing. Read-only. */
        readonly enemy: Entity<EntityRaw> | null;
        /** CFuncTrain/m_iszLastTarget — Read-only, as every string field is. */
        readonly lastTarget: string;
        /** CFuncTrain/m_flNextBlockTime */
        nextBlockTime: number;
        /** CFuncTrain/m_flSpeed */
        speed: number;
    }

    /** The fields a CGameEnd adds to CRulePointEntityRaw. */
    interface CGameEndRaw extends CRulePointEntityRaw {
    }

    /** The fields a CGameMoney adds to CRulePointEntityRaw. */
    interface CGameMoneyRaw extends CRulePointEntityRaw {
        /** CGameMoney/m_nMoney */
        money: number;
        /** CGameMoney/m_strAwardText — Read-only, as every string field is. */
        readonly strAwardText: string;
    }

    /** The fields a CGamePlayerEquip adds to CRulePointEntityRaw. */
    interface CGamePlayerEquipRaw extends CRulePointEntityRaw {
    }

    /** The fields a CGamePlayerZone adds to CRuleBrushEntityRaw. */
    interface CGamePlayerZoneRaw extends CRuleBrushEntityRaw {
    }

    /** The fields a CGameText adds to CRulePointEntityRaw. */
    interface CGameTextRaw extends CRulePointEntityRaw {
        /** CGameText/m_iszMessage — Read-only, as every string field is. */
        readonly message: string;
    }

    /** The fields a CGenericConstraint adds to CPhysConstraintRaw. */
    interface CGenericConstraintRaw extends CPhysConstraintRaw {
        /** CGenericConstraint/m_flAngularDampingRatioX */
        angularDampingRatioX: number;
        /** CGenericConstraint/m_flAngularDampingRatioY */
        angularDampingRatioY: number;
        /** CGenericConstraint/m_flAngularDampingRatioZ */
        angularDampingRatioZ: number;
        /** CGenericConstraint/m_flAngularFrequencyX */
        angularFrequencyX: number;
        /** CGenericConstraint/m_flAngularFrequencyY */
        angularFrequencyY: number;
        /** CGenericConstraint/m_flAngularFrequencyZ */
        angularFrequencyZ: number;
        /** CGenericConstraint/m_nAngularMotionX — A JointMotion_t. */
        angularMotionX: number;
        /** CGenericConstraint/m_nAngularMotionY — A JointMotion_t. */
        angularMotionY: number;
        /** CGenericConstraint/m_nAngularMotionZ — A JointMotion_t. */
        angularMotionZ: number;
        /** CGenericConstraint/m_bAxisNotifiedX */
        axisNotifiedX: boolean;
        /** CGenericConstraint/m_bAxisNotifiedY */
        axisNotifiedY: boolean;
        /** CGenericConstraint/m_bAxisNotifiedZ */
        axisNotifiedZ: boolean;
        /** CGenericConstraint/m_flBreakAfterTimeStartTimeX */
        breakAfterTimeStartTimeX: number;
        /** CGenericConstraint/m_flBreakAfterTimeStartTimeY */
        breakAfterTimeStartTimeY: number;
        /** CGenericConstraint/m_flBreakAfterTimeStartTimeZ */
        breakAfterTimeStartTimeZ: number;
        /** CGenericConstraint/m_flBreakAfterTimeThresholdX */
        breakAfterTimeThresholdX: number;
        /** CGenericConstraint/m_flBreakAfterTimeThresholdY */
        breakAfterTimeThresholdY: number;
        /** CGenericConstraint/m_flBreakAfterTimeThresholdZ */
        breakAfterTimeThresholdZ: number;
        /** CGenericConstraint/m_flBreakAfterTimeX */
        breakAfterTimeX: number;
        /** CGenericConstraint/m_flBreakAfterTimeY */
        breakAfterTimeY: number;
        /** CGenericConstraint/m_flBreakAfterTimeZ */
        breakAfterTimeZ: number;
        /** CGenericConstraint/m_flLinearDampingRatioX */
        linearDampingRatioX: number;
        /** CGenericConstraint/m_flLinearDampingRatioY */
        linearDampingRatioY: number;
        /** CGenericConstraint/m_flLinearDampingRatioZ */
        linearDampingRatioZ: number;
        /** CGenericConstraint/m_flLinearFrequencyX */
        linearFrequencyX: number;
        /** CGenericConstraint/m_flLinearFrequencyY */
        linearFrequencyY: number;
        /** CGenericConstraint/m_flLinearFrequencyZ */
        linearFrequencyZ: number;
        /** CGenericConstraint/m_nLinearMotionX — A JointMotion_t. */
        linearMotionX: number;
        /** CGenericConstraint/m_nLinearMotionY — A JointMotion_t. */
        linearMotionY: number;
        /** CGenericConstraint/m_nLinearMotionZ — A JointMotion_t. */
        linearMotionZ: number;
        /** CGenericConstraint/m_flMaxAngularImpulseX */
        maxAngularImpulseX: number;
        /** CGenericConstraint/m_flMaxAngularImpulseY */
        maxAngularImpulseY: number;
        /** CGenericConstraint/m_flMaxAngularImpulseZ */
        maxAngularImpulseZ: number;
        /** CGenericConstraint/m_flMaxLinearImpulseX */
        maxLinearImpulseX: number;
        /** CGenericConstraint/m_flMaxLinearImpulseY */
        maxLinearImpulseY: number;
        /** CGenericConstraint/m_flMaxLinearImpulseZ */
        maxLinearImpulseZ: number;
        /** CGenericConstraint/m_flNotifyForceLastTimeX */
        notifyForceLastTimeX: number;
        /** CGenericConstraint/m_flNotifyForceLastTimeY */
        notifyForceLastTimeY: number;
        /** CGenericConstraint/m_flNotifyForceLastTimeZ */
        notifyForceLastTimeZ: number;
        /** CGenericConstraint/m_flNotifyForceMinTimeX */
        notifyForceMinTimeX: number;
        /** CGenericConstraint/m_flNotifyForceMinTimeY */
        notifyForceMinTimeY: number;
        /** CGenericConstraint/m_flNotifyForceMinTimeZ */
        notifyForceMinTimeZ: number;
        /** CGenericConstraint/m_flNotifyForceX */
        notifyForceX: number;
        /** CGenericConstraint/m_flNotifyForceY */
        notifyForceY: number;
        /** CGenericConstraint/m_flNotifyForceZ */
        notifyForceZ: number;
        /** CGenericConstraint/m_bPlaceAnchorsAtConstraintTransform */
        placeAnchorsAtConstraintTransform: boolean;
    }

    /** The fields a CHostageExpresserShim adds to CBaseCombatCharacterRaw. */
    interface CHostageExpresserShimRaw extends CBaseCombatCharacterRaw {
    }

    /** The fields a CHostageRescueZoneShim adds to CBaseTriggerRaw. */
    interface CHostageRescueZoneShimRaw extends CBaseTriggerRaw {
    }

    /** The fields a CInfoDeathmatchSpawn adds to SpawnPointRaw. */
    interface CInfoDeathmatchSpawnRaw extends SpawnPointRaw {
    }

    /** The fields a CInfoPlayerCounterterrorist adds to SpawnPointRaw. */
    interface CInfoPlayerCounterterroristRaw extends SpawnPointRaw {
    }

    /** The fields a CInfoPlayerTerrorist adds to SpawnPointRaw. */
    interface CInfoPlayerTerroristRaw extends SpawnPointRaw {
    }

    /** The fields a CItemAssaultSuit adds to CItemRaw. */
    interface CItemAssaultSuitRaw extends CItemRaw {
    }

    /** The fields a CItemDefuser adds to CItemRaw. */
    interface CItemDefuserRaw extends CItemRaw {
        /** CItemDefuser/m_nSpotRules */
        spotRules: number;
    }

    /** The fields a CItemDogtags adds to CItemRaw. */
    interface CItemDogtagsRaw extends CItemRaw {
        /** CItemDogtags/m_KillingPlayer — Another entity, or null when it points at nothing. Read-only. */
        readonly killingPlayer: Entity<EntityRaw> | null;
        /** CItemDogtags/m_OwningPlayer — Another entity, or null when it points at nothing. Read-only. */
        readonly owningPlayer: Entity<EntityRaw> | null;
    }

    /** The fields a CItemGeneric adds to CItemRaw. */
    interface CItemGenericRaw extends CItemRaw {
        /** CItemGeneric/m_pAllowPickupScriptFunction — Read-only, as every string field is. */
        readonly allowPickupScriptFunction: string;
        /** CItemGeneric/m_pAmbientSoundEffect — Read-only, as every string field is. */
        readonly ambientSoundEffect: string;
        /** CItemGeneric/m_bAutoStartAmbientSound */
        autoStartAmbientSound: boolean;
        /** CItemGeneric/m_bGlowWhenInTrigger */
        glowWhenInTrigger: boolean;
        /** CItemGeneric/m_bHasPickupRadius */
        hasPickupRadius: boolean;
        /** CItemGeneric/m_bHasTriggerRadius */
        hasTriggerRadius: boolean;
        /** CItemGeneric/m_flLastPickupCheck */
        lastPickupCheck: number;
        /** CItemGeneric/m_hPickupFilter — Another entity, or null when it points at nothing. Read-only. */
        readonly pickupFilter: Entity<EntityRaw> | null;
        /** CItemGeneric/m_pPickupFilterName — Read-only, as every string field is. */
        readonly pickupFilterName: string;
        /** CItemGeneric/m_flPickupRadius */
        pickupRadius: number;
        /** CItemGeneric/m_flPickupRadiusSqr */
        pickupRadiusSqr: number;
        /** CItemGeneric/m_pPickupScriptFunction — Read-only, as every string field is. */
        readonly pickupScriptFunction: string;
        /** CItemGeneric/m_pPickupSoundEffect — Read-only, as every string field is. */
        readonly pickupSoundEffect: string;
        /** CItemGeneric/m_bPlayerCounterListenerAdded */
        playerCounterListenerAdded: boolean;
        /** CItemGeneric/m_bPlayerInTriggerRadius */
        playerInTriggerRadius: boolean;
        /** CItemGeneric/m_pSpawnScriptFunction — Read-only, as every string field is. */
        readonly spawnScriptFunction: string;
        /** CItemGeneric/m_pTimeoutScriptFunction — Read-only, as every string field is. */
        readonly timeoutScriptFunction: string;
        /** CItemGeneric/m_pTimeoutSoundEffect — Read-only, as every string field is. */
        readonly timeoutSoundEffect: string;
        /** CItemGeneric/m_hTriggerHelper — Another entity, or null when it points at nothing. Read-only. */
        readonly triggerHelper: Entity<EntityRaw> | null;
        /** CItemGeneric/m_flTriggerRadius */
        triggerRadius: number;
        /** CItemGeneric/m_flTriggerRadiusSqr */
        triggerRadiusSqr: number;
        /** CItemGeneric/m_pTriggerSoundEffect — Read-only, as every string field is. */
        readonly triggerSoundEffect: string;
        /** CItemGeneric/m_bUseable */
        useable: boolean;
    }

    /** The fields a CItemKevlar adds to CItemRaw. */
    interface CItemKevlarRaw extends CItemRaw {
    }

    /** The fields a CLightEnvironmentEntity adds to CLightDirectionalEntityRaw. */
    interface CLightEnvironmentEntityRaw extends CLightDirectionalEntityRaw {
    }

    /** The fields a CLogicActiveAutosave adds to CLogicAutosaveRaw. */
    interface CLogicActiveAutosaveRaw extends CLogicAutosaveRaw {
        /** CLogicActiveAutosave/m_flDangerousTime */
        dangerousTime: number;
        /** CLogicActiveAutosave/m_flStartTime */
        startTime: number;
        /** CLogicActiveAutosave/m_flTimeToTrigger */
        timeToTrigger: number;
        /** CLogicActiveAutosave/m_TriggerHitPoints */
        triggerHitPoints: number;
    }

    /** The fields a CMarkupVolumeTagged_Nav adds to CMarkupVolumeTaggedRaw. */
    interface CMarkupVolumeTagged_NavRaw extends CMarkupVolumeTaggedRaw {
        /** CMarkupVolumeTagged_Nav/m_nScopes — A NavScopeFlags_t. */
        scopes: number;
    }

    /** The fields a CMarkupVolumeWithRef adds to CMarkupVolumeTaggedRaw. */
    interface CMarkupVolumeWithRefRaw extends CMarkupVolumeTaggedRaw {
        /** CMarkupVolumeWithRef/m_flRefDot */
        refDot: number;
        /** CMarkupVolumeWithRef/m_bUseRef */
        useRef: boolean;
    }

    /** The fields a CPhysBallSocket adds to CPhysConstraintRaw. */
    interface CPhysBallSocketRaw extends CPhysConstraintRaw {
        /** CPhysBallSocket/m_bEnableSwingLimit */
        enableSwingLimit: boolean;
        /** CPhysBallSocket/m_bEnableTwistLimit */
        enableTwistLimit: boolean;
        /** CPhysBallSocket/m_flJointFriction */
        jointFriction: number;
        /** CPhysBallSocket/m_flMaxTwistAngle */
        maxTwistAngle: number;
        /** CPhysBallSocket/m_flMinTwistAngle */
        minTwistAngle: number;
        /** CPhysBallSocket/m_flSwingLimit */
        swingLimit: number;
    }

    /** The fields a CPhysFixed adds to CPhysConstraintRaw. */
    interface CPhysFixedRaw extends CPhysConstraintRaw {
        /** CPhysFixed/m_flAngularDampingRatio */
        angularDampingRatio: number;
        /** CPhysFixed/m_flAngularFrequency */
        angularFrequency: number;
        /** CPhysFixed/m_sBoneName1 — Read-only, as every string field is. */
        readonly boneName1: string;
        /** CPhysFixed/m_sBoneName2 — Read-only, as every string field is. */
        readonly boneName2: string;
        /** CPhysFixed/m_bEnableAngularConstraint */
        enableAngularConstraint: boolean;
        /** CPhysFixed/m_bEnableLinearConstraint */
        enableLinearConstraint: boolean;
        /** CPhysFixed/m_flLinearDampingRatio */
        linearDampingRatio: number;
        /** CPhysFixed/m_flLinearFrequency */
        linearFrequency: number;
    }

    /** The fields a CPhysHinge adds to CPhysConstraintRaw. */
    interface CPhysHingeRaw extends CPhysConstraintRaw {
        /** CPhysHinge/m_flAngleSpeed */
        angleSpeed: number;
        /** CPhysHinge/m_flAngleSpeedThreshold */
        angleSpeedThreshold: number;
        /** CPhysHinge/m_bAtMaxLimit */
        atMaxLimit: boolean;
        /** CPhysHinge/m_bAtMinLimit */
        atMinLimit: boolean;
        /** CPhysHinge/m_hingeFriction */
        hingeFriction: number;
        /** CPhysHinge/m_flInitialRotation */
        initialRotation: number;
        /** CPhysHinge/m_bIsAxisLocal */
        isAxisLocal: boolean;
        /** CPhysHinge/m_flLimitsDebugVisRotation */
        limitsDebugVisRotation: number;
        /** CPhysHinge/m_flMaxRotation */
        maxRotation: number;
        /** CPhysHinge/m_flMinRotation */
        minRotation: number;
        /** CPhysHinge/m_flMotorDampingRatio */
        motorDampingRatio: number;
        /** CPhysHinge/m_flMotorFrequency */
        motorFrequency: number;
        /** CPhysHinge/m_systemLoadScale */
        systemLoadScale: number;
    }

    /** The fields a CPhysLength adds to CPhysConstraintRaw. */
    interface CPhysLengthRaw extends CPhysConstraintRaw {
        /** CPhysLength/m_addLength */
        addLength: number;
        /** CPhysLength/m_minLength */
        minLength: number;
        /** CPhysLength/m_totalLength */
        totalLength: number;
    }

    /** The fields a CPhysPulley adds to CPhysConstraintRaw. */
    interface CPhysPulleyRaw extends CPhysConstraintRaw {
        /** CPhysPulley/m_addLength */
        addLength: number;
        /** CPhysPulley/m_gearRatio */
        gearRatio: number;
    }

    /** The fields a CPhysSlideConstraint adds to CPhysConstraintRaw. */
    interface CPhysSlideConstraintRaw extends CPhysConstraintRaw {
        /** CPhysSlideConstraint/m_bEnableAngularConstraint */
        enableAngularConstraint: boolean;
        /** CPhysSlideConstraint/m_bEnableLinearConstraint */
        enableLinearConstraint: boolean;
        /** CPhysSlideConstraint/m_initialOffset */
        initialOffset: number;
        /** CPhysSlideConstraint/m_flMotorDampingRatio */
        motorDampingRatio: number;
        /** CPhysSlideConstraint/m_flMotorFrequency */
        motorFrequency: number;
        /** CPhysSlideConstraint/m_slideFriction */
        slideFriction: number;
        /** CPhysSlideConstraint/m_systemLoadScale */
        systemLoadScale: number;
        /** CPhysSlideConstraint/m_bUseEntityPivot */
        useEntityPivot: boolean;
    }

    /** The fields a CPhysWheelConstraint adds to CPhysConstraintRaw. */
    interface CPhysWheelConstraintRaw extends CPhysConstraintRaw {
        /** CPhysWheelConstraint/m_bEnableSteeringLimit */
        enableSteeringLimit: boolean;
        /** CPhysWheelConstraint/m_bEnableSuspensionLimit */
        enableSuspensionLimit: boolean;
        /** CPhysWheelConstraint/m_flMaxSteeringAngle */
        maxSteeringAngle: number;
        /** CPhysWheelConstraint/m_flMaxSuspensionOffset */
        maxSuspensionOffset: number;
        /** CPhysWheelConstraint/m_flMinSteeringAngle */
        minSteeringAngle: number;
        /** CPhysWheelConstraint/m_flMinSuspensionOffset */
        minSuspensionOffset: number;
        /** CPhysWheelConstraint/m_flSpinAxisFriction */
        spinAxisFriction: number;
        /** CPhysWheelConstraint/m_flSteeringAxisFriction */
        steeringAxisFriction: number;
        /** CPhysWheelConstraint/m_hSteeringMimicsEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly steeringMimicsEntity: Entity<EntityRaw> | null;
        /** CPhysWheelConstraint/m_flSuspensionDampingRatio */
        suspensionDampingRatio: number;
        /** CPhysWheelConstraint/m_flSuspensionFrequency */
        suspensionFrequency: number;
        /** CPhysWheelConstraint/m_flSuspensionHeightOffset */
        suspensionHeightOffset: number;
    }

    /** The fields a CPhysicalButton adds to CBaseButtonRaw. */
    interface CPhysicalButtonRaw extends CBaseButtonRaw {
    }

    /** The fields a CPointClientUIWorldTextPanel adds to CPointClientUIWorldPanelRaw. */
    interface CPointClientUIWorldTextPanelRaw extends CPointClientUIWorldPanelRaw {
        /** CPointClientUIWorldTextPanel/m_messageText — Read-only, as every string field is. */
        readonly messageText: string;
    }

    /** Every field a CPostProcessingVolume has, by name. Flattened: it reuses a base field's name for a different type. */
    interface CPostProcessingVolumeRaw {
        /** CBaseToggle/m_hActivator — Another entity, or null when it points at nothing. Read-only. */
        readonly activator: Entity<EntityRaw> | null;
        /** CBaseEntity/m_flActualGravityScale */
        actualGravityScale: number;
        /** CBaseEntity/m_nActualMoveType — A MoveType_t. */
        actualMoveType: number;
        /** CBaseModelEntity/m_bAllowFadeInView */
        allowFadeInView: boolean;
        /** CBaseToggle/m_bAlwaysFireBlockedOutputs */
        alwaysFireBlockedOutputs: boolean;
        /** CBaseEntity/m_flAnimTime */
        animTime: number;
        /** CBaseEntity/m_bAnimatedEveryTick */
        animatedEveryTick: boolean;
        /** CBaseEntity/m_pBlocker — Another entity, or null when it points at nothing. Read-only. */
        readonly blocker: Entity<EntityRaw> | null;
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
        /** CBaseEntity/m_hDamageFilter — Another entity, or null when it points at nothing. Read-only. */
        readonly damageFilter: Entity<EntityRaw> | null;
        /** CBaseEntity/m_iszDamageFilterName — Read-only, as every string field is. */
        readonly damageFilterName: string;
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
        /** CBaseTrigger/m_bDisabled */
        disabled: boolean;
        /** CBaseEntity/m_bDisabledContextThinks */
        disabledContextThinks: boolean;
        /** CBaseModelEntity/m_flDissolveStartTime */
        dissolveStartTime: number;
        /** CBaseEntity/m_iEFlags */
        eFlags: number;
        /** CBaseEntity/m_hEffectEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly effectEntity: Entity<EntityRaw> | null;
        /** CBaseEntity/m_fEffects */
        effects: number;
        /** CBaseEntity/m_flElasticity */
        elasticity: number;
        /** CPostProcessingVolume/m_flExposureCompensation */
        exposureCompensation: number;
        /** CPostProcessingVolume/m_bExposureControl */
        exposureControl: boolean;
        /** CPostProcessingVolume/m_flExposureFadeSpeedDown */
        exposureFadeSpeedDown: number;
        /** CPostProcessingVolume/m_flExposureFadeSpeedUp */
        exposureFadeSpeedUp: number;
        /** CPostProcessingVolume/m_flFadeDuration */
        fadeDuration: number;
        /** CBaseModelEntity/m_fadeMaxDist */
        fadeMaxDist: number;
        /** CBaseModelEntity/m_fadeMinDist */
        fadeMinDist: number;
        /** CBaseModelEntity/m_flFadeScale */
        fadeScale: number;
        /** CBaseTrigger/m_hFilter — Another entity, or null when it points at nothing. Read-only. */
        readonly filter: Entity<EntityRaw> | null;
        /** CBaseTrigger/m_iFilterName — Read-only, as every string field is. */
        readonly filterName: string;
        /** CBaseEntity/m_fFlags */
        flags: number;
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
        /** CBaseEntity/m_nGroundBodyIndex */
        groundBodyIndex: number;
        /** CBaseEntity/m_hGroundEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly groundEntity: Entity<EntityRaw> | null;
        /** CBaseEntity/m_iHealth */
        health: number;
        /** CBaseToggle/m_flHeight */
        height: number;
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
        /** CBaseToggle/m_flLip */
        lip: number;
        /** CBaseEntity/m_flLocalTime */
        localTime: number;
        /** CPostProcessingVolume/m_bMaster */
        master: boolean;
        /** CPostProcessingVolume/m_flMaxExposure */
        maxExposure: number;
        /** CBaseEntity/m_iMaxHealth */
        maxHealth: number;
        /** CPostProcessingVolume/m_flMaxLogExposure */
        maxLogExposure: number;
        /** CPostProcessingVolume/m_flMinExposure */
        minExposure: number;
        /** CPostProcessingVolume/m_flMinLogExposure */
        minLogExposure: number;
        /** CBaseEntity/m_MoveCollide — A MoveCollide_t. */
        moveCollide: number;
        /** CBaseToggle/m_flMoveDistance */
        moveDistance: number;
        /** CBaseEntity/m_flMoveDoneTime */
        moveDoneTime: number;
        /** CBaseEntity/m_MoveType — A MoveType_t. */
        moveType: number;
        /** CBaseToggle/m_movementType */
        movementType: number;
        /** CBaseEntity/m_flNavIgnoreUntilTime */
        navIgnoreUntilTime: number;
        /** CBaseEntity/m_bNetworkQuantizeOriginAndAngles */
        networkQuantizeOriginAndAngles: boolean;
        /** CBaseEntity/m_nNextThinkTick */
        nextThinkTick: number;
        /** CBaseModelEntity/m_bNoInterpolate */
        noInterpolate: boolean;
        /** CBaseModelEntity/m_nObjectCulling */
        objectCulling: number;
        /** CBaseEntity/m_hOwnerEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly ownerEntity: Entity<EntityRaw> | null;
        /** CBaseEntity/m_nPlatformType — A EntityPlatformTypes_t. */
        platformType: number;
        /** CBaseEntity/m_nPreviouslySetMoveType — A MoveType_t. */
        previouslySetMoveType: number;
        /** CEntityInstance/m_iszPrivateVScripts — Read-only, as every string field is. */
        readonly privateVScripts: string;
        /** CBaseEntity/m_nPushEnumCount */
        pushEnumCount: number;
        /** CBaseModelEntity/m_nRenderFX — A RenderFx_t. */
        renderFX: number;
        /** CBaseModelEntity/m_nRenderMode — A RenderMode_t. */
        renderMode: number;
        /** CBaseModelEntity/m_bRenderToCubemaps */
        renderToCubemaps: boolean;
        /** CBaseEntity/m_iszResponseContext — Read-only, as every string field is. */
        readonly responseContext: string;
        /** CBaseEntity/m_bRestoreInHierarchy */
        restoreInHierarchy: boolean;
        /** CBaseEntity/m_iSentToClients */
        sentToClients: number;
        /** CBaseModelEntity/m_flShadowStrength */
        shadowStrength: number;
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
        /** CBaseToggle/m_toggle_state — A TOGGLE_STATE. */
        toggle_state: number;
        /** CPostProcessingVolume/m_flTonemapEVSmoothingRange */
        tonemapEVSmoothingRange: number;
        /** CBaseEntity/m_sUniqueHammerID — Read-only, as every string field is. */
        readonly uniqueHammerID: string;
        /** CBaseTrigger/m_bUseAsyncQueries */
        useAsyncQueries: boolean;
        /** CBaseEntity/m_flVPhysicsUpdateLocalTime */
        vPhysicsUpdateLocalTime: number;
        /** CBaseToggle/m_flWait */
        wait: number;
        /** CBaseEntity/m_flWaterLevel */
        waterLevel: number;
        /** CBaseEntity/m_nWaterTouch */
        waterTouch: number;
        /** CBaseEntity/m_nWaterType */
        waterType: number;
    }

    /** The fields a CPrecipitation adds to CBaseTriggerRaw. */
    interface CPrecipitationRaw extends CBaseTriggerRaw {
    }

    /** The fields a CRagdollConstraint adds to CPhysConstraintRaw. */
    interface CRagdollConstraintRaw extends CPhysConstraintRaw {
        /** CRagdollConstraint/m_xfriction */
        xfriction: number;
        /** CRagdollConstraint/m_xmax */
        xmax: number;
        /** CRagdollConstraint/m_xmin */
        xmin: number;
        /** CRagdollConstraint/m_yfriction */
        yfriction: number;
        /** CRagdollConstraint/m_ymax */
        ymax: number;
        /** CRagdollConstraint/m_ymin */
        ymin: number;
        /** CRagdollConstraint/m_zfriction */
        zfriction: number;
        /** CRagdollConstraint/m_zmax */
        zmax: number;
        /** CRagdollConstraint/m_zmin */
        zmin: number;
    }

    /** The fields a CRagdollPropAlias_physics_prop_ragdoll adds to CRagdollPropRaw. */
    interface CRagdollPropAlias_physics_prop_ragdollRaw extends CRagdollPropRaw {
    }

    /** The fields a CRagdollPropAttached adds to CRagdollPropRaw. */
    interface CRagdollPropAttachedRaw extends CRagdollPropRaw {
        /** CRagdollPropAttached/m_boneIndexAttached */
        boneIndexAttached: number;
        /** CRagdollPropAttached/m_ragdollAttachedObjectIndex */
        ragdollAttachedObjectIndex: number;
        /** CRagdollPropAttached/m_bShouldDeleteAttachedActivationRecord */
        shouldDeleteAttachedActivationRecord: boolean;
        /** CRagdollPropAttached/m_bShouldDetach */
        shouldDetach: boolean;
    }

    /** The fields a CRotButton adds to CBaseButtonRaw. */
    interface CRotButtonRaw extends CBaseButtonRaw {
    }

    /** The fields a CRotDoor adds to CBaseDoorRaw. */
    interface CRotDoorRaw extends CBaseDoorRaw {
        /** CRotDoor/m_bSolidBsp */
        solidBsp: boolean;
    }

    /** The fields a CScriptItem adds to CItemRaw. */
    interface CScriptItemRaw extends CItemRaw {
        /** CScriptItem/m_MoveTypeOverride — A MoveType_t. */
        moveTypeOverride: number;
    }

    /** The fields a CServerRagdollTrigger adds to CBaseTriggerRaw. */
    interface CServerRagdollTriggerRaw extends CBaseTriggerRaw {
    }

    /** The fields a CSimpleMarkupVolumeTagged adds to CMarkupVolumeTaggedRaw. */
    interface CSimpleMarkupVolumeTaggedRaw extends CMarkupVolumeTaggedRaw {
    }

    /** The fields a CSoundOpvarSetAABBEntity adds to CSoundOpvarSetBoxEntityRaw. */
    interface CSoundOpvarSetAABBEntityRaw extends CSoundOpvarSetBoxEntityRaw {
    }

    /** The fields a CSplineConstraint adds to CPhysConstraintRaw. */
    interface CSplineConstraintRaw extends CPhysConstraintRaw {
        /** CSplineConstraint/m_bEnableAngularConstraint */
        enableAngularConstraint: boolean;
        /** CSplineConstraint/m_bEnableLateralConstraint */
        enableLateralConstraint: boolean;
        /** CSplineConstraint/m_bEnableLimit */
        enableLimit: boolean;
        /** CSplineConstraint/m_bEnableVerticalConstraint */
        enableVerticalConstraint: boolean;
        /** CSplineConstraint/m_bFireEventsOnPath */
        fireEventsOnPath: boolean;
        /** CSplineConstraint/m_flJointFriction */
        jointFriction: number;
        /** CSplineConstraint/m_flLinarDampingRatio */
        linarDampingRatio: number;
        /** CSplineConstraint/m_flLinearFrequency */
        linearFrequency: number;
        /** CSplineConstraint/m_hSplineEntity — Another entity, or null when it points at nothing. Read-only. */
        readonly splineEntity: Entity<EntityRaw> | null;
        /** CSplineConstraint/m_StartTransitionTime */
        startTransitionTime: number;
        /** CSplineConstraint/m_flTransitionTime */
        transitionTime: number;
    }

    /** The fields a CTonemapTrigger adds to CBaseTriggerRaw. */
    interface CTonemapTriggerRaw extends CBaseTriggerRaw {
        /** CTonemapTrigger/m_hTonemapController — Another entity, or null when it points at nothing. Read-only. */
        readonly tonemapController: Entity<EntityRaw> | null;
        /** CTonemapTrigger/m_tonemapControllerName — Read-only, as every string field is. */
        readonly tonemapControllerName: string;
    }

    /** The fields a CTriggerActiveWeaponDetect adds to CBaseTriggerRaw. */
    interface CTriggerActiveWeaponDetectRaw extends CBaseTriggerRaw {
        /** CTriggerActiveWeaponDetect/m_iszWeaponClassName — Read-only, as every string field is. */
        readonly weaponClassName: string;
    }

    /** The fields a CTriggerBombReset adds to CBaseTriggerRaw. */
    interface CTriggerBombResetRaw extends CBaseTriggerRaw {
    }

    /** The fields a CTriggerBuoyancy adds to CBaseTriggerRaw. */
    interface CTriggerBuoyancyRaw extends CBaseTriggerRaw {
        /** CTriggerBuoyancy/m_flFluidDensity */
        fluidDensity: number;
    }

    /** The fields a CTriggerCallback adds to CBaseTriggerRaw. */
    interface CTriggerCallbackRaw extends CBaseTriggerRaw {
    }

    /** The fields a CTriggerDetectBulletFire adds to CBaseTriggerRaw. */
    interface CTriggerDetectBulletFireRaw extends CBaseTriggerRaw {
        /** CTriggerDetectBulletFire/m_bPlayerFireOnly */
        playerFireOnly: boolean;
    }

    /** The fields a CTriggerDetectExplosion adds to CBaseTriggerRaw. */
    interface CTriggerDetectExplosionRaw extends CBaseTriggerRaw {
    }

    /** The fields a CTriggerFan adds to CBaseTriggerRaw. */
    interface CTriggerFanRaw extends CBaseTriggerRaw {
        /** CTriggerFan/m_bFalloff */
        falloff: boolean;
        /** CTriggerFan/m_flForce */
        force: number;
        /** CTriggerFan/m_hInfoFan — Another entity, or null when it points at nothing. Read-only. */
        readonly hInfoFan: Entity<EntityRaw> | null;
        /** CTriggerFan/m_iszInfoFan — Read-only, as every string field is. */
        readonly iszInfoFan: string;
        /** CTriggerFan/m_nManagerFanIdx */
        managerFanIdx: number;
        /** CTriggerFan/m_flNPCForce */
        nPCForce: number;
        /** CTriggerFan/m_fNoiseDegrees */
        noiseDegrees: number;
        /** CTriggerFan/m_fNoiseSpeed */
        noiseSpeed: number;
        /** CTriggerFan/m_flParticleForceScale */
        particleForceScale: number;
        /** CTriggerFan/m_flPlayerForce */
        playerForce: number;
        /** CTriggerFan/m_bPlayerWindblock */
        playerWindblock: boolean;
        /** CTriggerFan/m_bPushAwayFromInfoTarget */
        pushAwayFromInfoTarget: boolean;
        /** CTriggerFan/m_bPushPlayer */
        pushPlayer: boolean;
        /** CTriggerFan/m_bPushTowardsInfoTarget */
        pushTowardsInfoTarget: boolean;
        /** CTriggerFan/m_bRampDown */
        rampDown: boolean;
        /** CTriggerFan/m_flRampTime */
        rampTime: number;
        /** CTriggerFan/m_flRopeForceScale */
        ropeForceScale: number;
    }

    /** The fields a CTriggerGameEvent adds to CBaseTriggerRaw. */
    interface CTriggerGameEventRaw extends CBaseTriggerRaw {
        /** CTriggerGameEvent/m_strEndTouchEventName — Read-only, as every string field is. */
        readonly strEndTouchEventName: string;
        /** CTriggerGameEvent/m_strStartTouchEventName — Read-only, as every string field is. */
        readonly strStartTouchEventName: string;
        /** CTriggerGameEvent/m_strTriggerID — Read-only, as every string field is. */
        readonly strTriggerID: string;
    }

    /** The fields a CTriggerGravity adds to CBaseTriggerRaw. */
    interface CTriggerGravityRaw extends CBaseTriggerRaw {
    }

    /** The fields a CTriggerHostageReset adds to CBaseTriggerRaw. */
    interface CTriggerHostageResetRaw extends CBaseTriggerRaw {
    }

    /** The fields a CTriggerHurt adds to CBaseTriggerRaw. */
    interface CTriggerHurtRaw extends CBaseTriggerRaw {
        /** CTriggerHurt/m_bitsDamageInflict — A DamageTypes_t. */
        bitsDamageInflict: number;
        /** CTriggerHurt/m_flDamage */
        damage: number;
        /** CTriggerHurt/m_flDamageCap */
        damageCap: number;
        /** CTriggerHurt/m_damageModel */
        damageModel: number;
        /** CTriggerHurt/m_flForgivenessDelay */
        forgivenessDelay: number;
        /** CTriggerHurt/m_hurtThinkPeriod */
        hurtThinkPeriod: number;
        /** CTriggerHurt/m_flLastDmgTime */
        lastDmgTime: number;
        /** CTriggerHurt/m_bNoDmgForce */
        noDmgForce: boolean;
        /** CTriggerHurt/m_flOriginalDamage */
        originalDamage: number;
        /** CTriggerHurt/m_thinkAlways */
        thinkAlways: boolean;
    }

    /** The fields a CTriggerLerpObject adds to CBaseTriggerRaw. */
    interface CTriggerLerpObjectRaw extends CBaseTriggerRaw {
        /** CTriggerLerpObject/m_bAttachTouchingObject */
        attachTouchingObject: boolean;
        /** CTriggerLerpObject/m_bAttachedEntityWasParented */
        attachedEntityWasParented: boolean;
        /** CTriggerLerpObject/m_hEntityToWaitForDisconnect — Another entity, or null when it points at nothing. Read-only. */
        readonly entityToWaitForDisconnect: Entity<EntityRaw> | null;
        /** CTriggerLerpObject/m_hLerpTarget — Another entity, or null when it points at nothing. Read-only. */
        readonly hLerpTarget: Entity<EntityRaw> | null;
        /** CTriggerLerpObject/m_iszLerpTarget — Read-only, as every string field is. */
        readonly iszLerpTarget: string;
        /** CTriggerLerpObject/m_iszLerpTargetAttachment — Read-only, as every string field is. */
        readonly iszLerpTargetAttachment: string;
        /** CTriggerLerpObject/m_flLerpDuration */
        lerpDuration: number;
        /** CTriggerLerpObject/m_iszLerpEffect — Read-only, as every string field is. */
        readonly lerpEffect: string;
        /** CTriggerLerpObject/m_bLerpRestoreMoveType */
        lerpRestoreMoveType: boolean;
        /** CTriggerLerpObject/m_iszLerpSound — Read-only, as every string field is. */
        readonly lerpSound: string;
        /** CTriggerLerpObject/m_bSingleLerpObject */
        singleLerpObject: boolean;
    }

    /** The fields a CTriggerMultiple adds to CBaseTriggerRaw. */
    interface CTriggerMultipleRaw extends CBaseTriggerRaw {
    }

    /** The fields a CTriggerPhysics adds to CBaseTriggerRaw. */
    interface CTriggerPhysicsRaw extends CBaseTriggerRaw {
        /** CTriggerPhysics/m_angularDamping */
        angularDamping: number;
        /** CTriggerPhysics/m_angularLimit */
        angularLimit: number;
        /** CTriggerPhysics/m_bCollapseToForcePoint */
        collapseToForcePoint: boolean;
        /** CTriggerPhysics/m_bConvertToDebrisWhenPossible */
        convertToDebrisWhenPossible: boolean;
        /** CTriggerPhysics/m_flDampingRatio */
        dampingRatio: number;
        /** CTriggerPhysics/m_flFrequency */
        frequency: number;
        /** CTriggerPhysics/m_gravityScale */
        gravityScale: number;
        /** CTriggerPhysics/m_linearDamping */
        linearDamping: number;
        /** CTriggerPhysics/m_linearForce */
        linearForce: number;
        /** CTriggerPhysics/m_linearLimit */
        linearLimit: number;
    }

    /** The fields a CTriggerProximity adds to CBaseTriggerRaw. */
    interface CTriggerProximityRaw extends CBaseTriggerRaw {
        /** CTriggerProximity/m_hMeasureTarget — Another entity, or null when it points at nothing. Read-only. */
        readonly hMeasureTarget: Entity<EntityRaw> | null;
        /** CTriggerProximity/m_iszMeasureTarget — Read-only, as every string field is. */
        readonly iszMeasureTarget: string;
        /** CTriggerProximity/m_fRadius */
        radius: number;
        /** CTriggerProximity/m_nTouchers */
        touchers: number;
    }

    /** The fields a CTriggerPush adds to CBaseTriggerRaw. */
    interface CTriggerPushRaw extends CBaseTriggerRaw {
        /** CTriggerPush/m_PathSimple — Another entity, or null when it points at nothing. Read-only. */
        readonly pathSimple: Entity<EntityRaw> | null;
        /** CTriggerPush/m_iszPathSimpleName — Read-only, as every string field is. */
        readonly pathSimpleName: string;
        /** CTriggerPush/m_flSpeed */
        speed: number;
        /** CTriggerPush/m_splinePushType */
        splinePushType: number;
        /** CTriggerPush/m_bTriggerOnStartTouch */
        triggerOnStartTouch: boolean;
        /** CTriggerPush/m_bUsePathSimple */
        usePathSimple: boolean;
    }

    /** The fields a CTriggerRemove adds to CBaseTriggerRaw. */
    interface CTriggerRemoveRaw extends CBaseTriggerRaw {
    }

    /** The fields a CTriggerSave adds to CBaseTriggerRaw. */
    interface CTriggerSaveRaw extends CBaseTriggerRaw {
        /** CTriggerSave/m_fDangerousTimer */
        dangerousTimer: number;
        /** CTriggerSave/m_bForceNewLevelUnit */
        forceNewLevelUnit: boolean;
        /** CTriggerSave/m_minHitPoints */
        minHitPoints: number;
        /** CTriggerSave/m_flRetriggerDelay */
        retriggerDelay: number;
    }

    /** The fields a CTriggerSndSosOpvar adds to CBaseTriggerRaw. */
    interface CTriggerSndSosOpvarRaw extends CBaseTriggerRaw {
        /** CTriggerSndSosOpvar/m_flCenterSize */
        centerSize: number;
        /** CTriggerSndSosOpvar/m_flMaxVal */
        maxVal: number;
        /** CTriggerSndSosOpvar/m_flMinVal */
        minVal: number;
        /** CTriggerSndSosOpvar/m_flNormCenterSize */
        normCenterSize: number;
        /** CTriggerSndSosOpvar/m_operatorName — Read-only, as every string field is. */
        readonly operatorName: string;
        /** CTriggerSndSosOpvar/m_operatorNameChar — Read-only, as every string field is. */
        readonly operatorNameChar: string;
        /** CTriggerSndSosOpvar/m_opvarName — Read-only, as every string field is. */
        readonly opvarName: string;
        /** CTriggerSndSosOpvar/m_opvarNameChar — Read-only, as every string field is. */
        readonly opvarNameChar: string;
        /** CTriggerSndSosOpvar/m_stackName — Read-only, as every string field is. */
        readonly stackName: string;
        /** CTriggerSndSosOpvar/m_stackNameChar — Read-only, as every string field is. */
        readonly stackNameChar: string;
        /** CTriggerSndSosOpvar/m_bVolIs2D */
        volIs2D: boolean;
    }

    /** The fields a CTriggerSoundscape adds to CBaseTriggerRaw. */
    interface CTriggerSoundscapeRaw extends CBaseTriggerRaw {
        /** CTriggerSoundscape/m_hSoundscape — Another entity, or null when it points at nothing. Read-only. */
        readonly soundscape: Entity<EntityRaw> | null;
        /** CTriggerSoundscape/m_SoundscapeName — Read-only, as every string field is. */
        readonly soundscapeName: string;
    }

    /** The fields a CTriggerTeleport adds to CBaseTriggerRaw. */
    interface CTriggerTeleportRaw extends CBaseTriggerRaw {
        /** CTriggerTeleport/m_bCheckDestIfClearForPlayer */
        checkDestIfClearForPlayer: boolean;
        /** CTriggerTeleport/m_iLandmark — Read-only, as every string field is. */
        readonly landmark: string;
        /** CTriggerTeleport/m_bMirrorPlayer */
        mirrorPlayer: boolean;
        /** CTriggerTeleport/m_bUseLandmarkAngles */
        useLandmarkAngles: boolean;
    }

    /** The fields a FilterDamageType adds to CBaseFilterRaw. */
    interface FilterDamageTypeRaw extends CBaseFilterRaw {
        /** FilterDamageType/m_iDamageType */
        damageType: number;
    }

    /** The fields a FilterHealth adds to CBaseFilterRaw. */
    interface FilterHealthRaw extends CBaseFilterRaw {
        /** FilterHealth/m_bAdrenalineActive */
        adrenalineActive: boolean;
        /** FilterHealth/m_iHealthMax */
        healthMax: number;
        /** FilterHealth/m_iHealthMin */
        healthMin: number;
    }

    /** The fields a CCSPlayerPawnBase adds to CBasePlayerPawnRaw. */
    interface CCSPlayerPawnBaseRaw extends CBasePlayerPawnRaw {
        /** CCSPlayerPawnBase/m_blindStartTime */
        blindStartTime: number;
        /** CCSPlayerPawnBase/m_blindUntilTime */
        blindUntilTime: number;
        /** CCSPlayerPawnBase/m_flFlashDuration */
        flashDuration: number;
        /** CCSPlayerPawnBase/m_flFlashMaxAlpha */
        flashMaxAlpha: number;
        /** CCSPlayerPawnBase/m_bHasMovedSinceSpawn */
        hasMovedSinceSpawn: boolean;
        /** CCSPlayerPawnBase/m_flIdleTimeSinceLastAction */
        idleTimeSinceLastAction: number;
        /** CCSPlayerPawnBase/m_fNextRadarUpdateTime */
        nextRadarUpdateTime: number;
        /** CCSPlayerPawnBase/m_iNumSpawns */
        numSpawns: number;
        /** CCSPlayerPawnBase/m_hOriginalController — Another entity, or null when it points at nothing. Read-only. */
        readonly originalController: Entity<EntityRaw> | null;
        /** CCSPlayerPawnBase/m_iPlayerState — A CSPlayerState. */
        playerState: number;
        /** CCSPlayerPawnBase/m_iProgressBarDuration */
        progressBarDuration: number;
        /** CCSPlayerPawnBase/m_flProgressBarStartTime */
        progressBarStartTime: number;
        /** CCSPlayerPawnBase/m_bRespawning */
        respawning: boolean;
    }

    /** The fields a CCSWeaponBase adds to CBasePlayerWeaponRaw. */
    interface CCSWeaponBaseRaw extends CBasePlayerWeaponRaw {
        /** CCSWeaponBase/m_fAccuracyPenalty */
        accuracyPenalty: number;
        /** CCSWeaponBase/m_fAccuracySmoothedForZoom */
        accuracySmoothedForZoom: number;
        /** CCSWeaponBase/m_bBurstMode */
        burstMode: boolean;
        /** CCSWeaponBase/m_bCanBePickedUp */
        canBePickedUp: boolean;
        /** CCSWeaponBase/m_nDeployTick */
        deployTick: number;
        /** CCSWeaponBase/m_donated */
        donated: boolean;
        /** CCSWeaponBase/m_nDropTick */
        dropTick: number;
        /** CCSWeaponBase/m_flDroppedAtTime */
        droppedAtTime: number;
        /** CCSWeaponBase/m_bDroppedNearBuyZone */
        droppedNearBuyZone: boolean;
        /** CCSWeaponBase/m_bFireOnEmpty */
        fireOnEmpty: boolean;
        /** CCSWeaponBase/m_flRecoilIndex */
        flRecoilIndex: number;
        /** CCSWeaponBase/m_iRecoilIndex */
        iRecoilIndex: number;
        /** CCSWeaponBase/m_bInReload */
        inReload: boolean;
        /** CCSWeaponBase/m_flInspectCancelCompleteTime */
        inspectCancelCompleteTime: number;
        /** CCSWeaponBase/m_bInspectPending */
        inspectPending: boolean;
        /** CCSWeaponBase/m_bInspectShouldLoop */
        inspectShouldLoop: boolean;
        /** CCSWeaponBase/m_iIronSightMode */
        ironSightMode: number;
        /** CCSWeaponBase/m_bIsHauledBack */
        isHauledBack: boolean;
        /** CCSWeaponBase/m_flLastAccuracyUpdateTime */
        lastAccuracyUpdateTime: number;
        /** CCSWeaponBase/m_nLastEmptySoundCmdNum */
        lastEmptySoundCmdNum: number;
        /** CCSWeaponBase/m_flLastLOSTraceFailureTime */
        lastLOSTraceFailureTime: number;
        /** CCSWeaponBase/m_flLastShakeTime */
        lastShakeTime: number;
        /** CCSWeaponBase/m_fLastShotTime */
        lastShotTime: number;
        /** CCSWeaponBase/m_iMostRecentTeamNumber */
        mostRecentTeamNumber: number;
        /** CCSWeaponBase/m_flNextAttackRenderTimeOffset */
        nextAttackRenderTimeOffset: number;
        /** CCSWeaponBase/m_nextOwnerTouchTime */
        nextOwnerTouchTime: number;
        /** CCSWeaponBase/m_nextPrevOwnerTouchTime */
        nextPrevOwnerTouchTime: number;
        /** CCSWeaponBase/m_nextPrevOwnerUseTime */
        nextPrevOwnerUseTime: number;
        /** CCSWeaponBase/m_numRemoveUnownedWeaponThink */
        numRemoveUnownedWeaponThink: number;
        /** CCSWeaponBase/m_iOriginalTeamNumber */
        originalTeamNumber: number;
        /** CCSWeaponBase/m_bPlayerAmmoStockOnPickup */
        playerAmmoStockOnPickup: boolean;
        /** CCSWeaponBase/m_flPostponeFireReadyFrac */
        postponeFireReadyFrac: number;
        /** CCSWeaponBase/m_nPostponeFireReadyTicks */
        postponeFireReadyTicks: number;
        /** CCSWeaponBase/m_hPrevOwner — Another entity, or null when it points at nothing. Read-only. */
        readonly prevOwner: Entity<EntityRaw> | null;
        /** CCSWeaponBase/m_bRemoveable */
        removeable: boolean;
        /** CCSWeaponBase/m_bRequireUseToTouch */
        requireUseToTouch: boolean;
        /** CCSWeaponBase/m_bSilencerOn */
        silencerOn: boolean;
        /** CCSWeaponBase/m_flTimeSilencerSwitchComplete */
        timeSilencerSwitchComplete: number;
        /** CCSWeaponBase/m_flTurningInaccuracy */
        turningInaccuracy: number;
        /** CCSWeaponBase/m_flTurningInaccuracyDelta */
        turningInaccuracyDelta: number;
        /** CCSWeaponBase/m_bUseCanOverrideNextOwnerTouchTime */
        useCanOverrideNextOwnerTouchTime: boolean;
        /** CCSWeaponBase/m_bWasActiveWeaponWhenDropped */
        wasActiveWeaponWhenDropped: boolean;
        /** CCSWeaponBase/m_bWasOwnedByCT */
        wasOwnedByCT: boolean;
        /** CCSWeaponBase/m_bWasOwnedByTerrorist */
        wasOwnedByTerrorist: boolean;
        /** CCSWeaponBase/m_flWatTickOffset */
        watTickOffset: number;
        /** CCSWeaponBase/m_flWeaponActionPlaybackRate */
        weaponActionPlaybackRate: number;
        /** CCSWeaponBase/m_iWeaponGameplayAnimState — A WeaponGameplayAnimState. */
        weaponGameplayAnimState: number;
        /** CCSWeaponBase/m_flWeaponGameplayAnimStateTimestamp */
        weaponGameplayAnimStateTimestamp: number;
        /** CCSWeaponBase/m_weaponMode — A CSWeaponMode. */
        weaponMode: number;
    }

    /** The fields a CDecoyProjectile adds to CBaseCSGrenadeProjectileRaw. */
    interface CDecoyProjectileRaw extends CBaseCSGrenadeProjectileRaw {
        /** CDecoyProjectile/m_nDecoyShotTick */
        decoyShotTick: number;
        /** CDecoyProjectile/m_decoyWeaponDefIndex */
        decoyWeaponDefIndex: number;
        /** CDecoyProjectile/m_fExpireTime */
        expireTime: number;
        /** CDecoyProjectile/m_shotsRemaining */
        shotsRemaining: number;
    }

    /** The fields a CDynamicNavConnectionsVolume adds to CTriggerMultipleRaw. */
    interface CDynamicNavConnectionsVolumeRaw extends CTriggerMultipleRaw {
        /** CDynamicNavConnectionsVolume/m_iszConnectionTarget — Read-only, as every string field is. */
        readonly connectionTarget: string;
        /** CDynamicNavConnectionsVolume/m_bConnectionsEnabled */
        connectionsEnabled: boolean;
        /** CDynamicNavConnectionsVolume/m_flMaxConnectionDistance */
        maxConnectionDistance: number;
        /** CDynamicNavConnectionsVolume/m_flTargetAreaSearchRadius */
        targetAreaSearchRadius: number;
        /** CDynamicNavConnectionsVolume/m_sTransitionType — Read-only, as every string field is. */
        readonly transitionType: string;
        /** CDynamicNavConnectionsVolume/m_flUpdateDistance */
        updateDistance: number;
    }

    /** The fields a CDynamicProp adds to CBreakablePropRaw. */
    interface CDynamicPropRaw extends CBreakablePropRaw {
        /** CDynamicProp/m_bCreateMovableSurfaceGraph */
        createMovableSurfaceGraph: boolean;
        /** CDynamicProp/m_bCreateNavObstacle */
        createNavObstacle: boolean;
        /** CDynamicProp/m_bCreateNonSolid */
        createNonSolid: boolean;
        /** CDynamicProp/m_bFiredStartEndOutput */
        firedStartEndOutput: boolean;
        /** CDynamicProp/m_bForceNpcExclude */
        forceNpcExclude: boolean;
        /** CDynamicProp/m_nGlowRange */
        glowRange: number;
        /** CDynamicProp/m_nGlowRangeMin */
        glowRangeMin: number;
        /** CDynamicProp/m_nGlowTeam */
        glowTeam: number;
        /** CDynamicProp/m_iszIdleAnim — Read-only, as every string field is. */
        readonly idleAnim: string;
        /** CDynamicProp/m_nIdleAnimLoopMode — A AnimLoopMode_t. */
        idleAnimLoopMode: number;
        /** CDynamicProp/m_iInitialGlowState */
        initialGlowState: number;
        /** CDynamicProp/m_bIsOverrideProp */
        isOverrideProp: boolean;
        /** CDynamicProp/m_bNavObstacleUpdatesOverridden */
        navObstacleUpdatesOverridden: boolean;
        /** CDynamicProp/m_bRandomizeCycle */
        randomizeCycle: boolean;
        /** CDynamicProp/m_bStartDisabled */
        startDisabled: boolean;
        /** CDynamicProp/m_bUseAnimGraph */
        useAnimGraph: boolean;
        /** CDynamicProp/m_bUseHitboxesForRenderBox */
        useHitboxesForRenderBox: boolean;
    }

    /** The fields a CFlashbangProjectile adds to CBaseCSGrenadeProjectileRaw. */
    interface CFlashbangProjectileRaw extends CBaseCSGrenadeProjectileRaw {
        /** CFlashbangProjectile/m_numOpponentsHit */
        numOpponentsHit: number;
        /** CFlashbangProjectile/m_numTeammatesHit */
        numTeammatesHit: number;
        /** CFlashbangProjectile/m_flTimeToDetonate */
        timeToDetonate: number;
    }

    /** The fields a CFuncPlatRot adds to CFuncPlatRaw. */
    interface CFuncPlatRotRaw extends CFuncPlatRaw {
    }

    /** The fields a CHEGrenadeProjectile adds to CBaseCSGrenadeProjectileRaw. */
    interface CHEGrenadeProjectileRaw extends CBaseCSGrenadeProjectileRaw {
    }

    /** The fields a CHostage adds to CHostageExpresserShimRaw. */
    interface CHostageRaw extends CHostageExpresserShimRaw {
        /** CHostage/m_nApproachRewardPayouts */
        approachRewardPayouts: number;
        /** CHostage/m_flDropStartTime */
        dropStartTime: number;
        /** CHostage/m_flGrabSuccessTime */
        grabSuccessTime: number;
        /** CHostage/m_bHandsHaveBeenCut */
        handsHaveBeenCut: boolean;
        /** CHostage/m_hasBeenUsed */
        hasBeenUsed: boolean;
        /** CHostage/m_hHostageGrabber — Another entity, or null when it points at nothing. Read-only. */
        readonly hostageGrabber: Entity<EntityRaw> | null;
        /** CHostage/m_nHostageSpawnRandomFactor */
        hostageSpawnRandomFactor: number;
        /** CHostage/m_nHostageState */
        hostageState: number;
        /** CHostage/m_isAdjusted */
        isAdjusted: boolean;
        /** CHostage/m_isCrouching */
        isCrouching: boolean;
        /** CHostage/m_isRescued */
        isRescued: boolean;
        /** CHostage/m_isRunning */
        isRunning: boolean;
        /** CHostage/m_isWaitingForLeader */
        isWaitingForLeader: boolean;
        /** CHostage/m_jumpedThisFrame */
        jumpedThisFrame: boolean;
        /** CHostage/m_fLastGrabTime */
        lastGrabTime: number;
        /** CHostage/m_lastLeader — Another entity, or null when it points at nothing. Read-only. */
        readonly lastLeader: Entity<EntityRaw> | null;
        /** CHostage/m_leader — Another entity, or null when it points at nothing. Read-only. */
        readonly leader: Entity<EntityRaw> | null;
        /** CHostage/m_nPickupEventCount */
        pickupEventCount: number;
        /** CHostage/m_flRescueStartTime */
        rescueStartTime: number;
        /** CHostage/m_bRemove */
        shouldRemove: boolean;
        /** CHostage/m_nSpotRules */
        spotRules: number;
        /** CHostage/m_uiHostageSpawnExclusionGroupMask */
        uiHostageSpawnExclusionGroupMask: number;
    }

    /** The fields a CHostageRescueZone adds to CHostageRescueZoneShimRaw. */
    interface CHostageRescueZoneRaw extends CHostageRescueZoneShimRaw {
    }

    /** The fields a CItemDefuserAlias_item_defuser adds to CItemDefuserRaw. */
    interface CItemDefuserAlias_item_defuserRaw extends CItemDefuserRaw {
    }

    /** The fields a CMarkupVolumeTagged_NavGame adds to CMarkupVolumeWithRefRaw. */
    interface CMarkupVolumeTagged_NavGameRaw extends CMarkupVolumeWithRefRaw {
        /** CMarkupVolumeTagged_NavGame/m_bFloodFillAttribute */
        floodFillAttribute: boolean;
        /** CMarkupVolumeTagged_NavGame/m_nScopes — A NavScopeFlags_t. */
        scopes: number;
        /** CMarkupVolumeTagged_NavGame/m_bSplitNavSpace */
        splitNavSpace: boolean;
    }

    /** The fields a CMolotovProjectile adds to CBaseCSGrenadeProjectileRaw. */
    interface CMolotovProjectileRaw extends CBaseCSGrenadeProjectileRaw {
        /** CMolotovProjectile/m_bDetonated */
        detonated: boolean;
        /** CMolotovProjectile/m_bIsIncGrenade */
        isIncGrenade: boolean;
    }

    /** The fields a CMomentaryRotButton adds to CRotButtonRaw. */
    interface CMomentaryRotButtonRaw extends CRotButtonRaw {
        /** CMomentaryRotButton/m_direction */
        direction: number;
        /** CMomentaryRotButton/m_IdealYaw */
        idealYaw: number;
        /** CMomentaryRotButton/m_lastUsed */
        lastUsed: number;
        /** CMomentaryRotButton/m_sNoise — Read-only, as every string field is. */
        readonly noise: string;
        /** CMomentaryRotButton/m_returnSpeed */
        returnSpeed: number;
        /** CMomentaryRotButton/m_flStartPosition */
        startPosition: number;
        /** CMomentaryRotButton/m_bUpdateTarget */
        updateTarget: boolean;
    }

    /** The fields a CPhysHingeAlias_phys_hinge_local adds to CPhysHingeRaw. */
    interface CPhysHingeAlias_phys_hinge_localRaw extends CPhysHingeRaw {
    }

    /** The fields a CPhysicsProp adds to CBreakablePropRaw. */
    interface CPhysicsPropRaw extends CBreakablePropRaw {
        /** CPhysicsProp/m_bAcceptDamageFromHeldObjects */
        acceptDamageFromHeldObjects: boolean;
        /** CPhysicsProp/m_bAllowObstacleConvexHullMerging */
        allowObstacleConvexHullMerging: boolean;
        /** CPhysicsProp/m_bAttachedToReferenceFrame */
        attachedToReferenceFrame: boolean;
        /** CPhysicsProp/m_bAwake */
        awake: boolean;
        /** CPhysicsProp/m_buoyancyScale */
        buoyancyScale: number;
        /** CPhysicsProp/m_CrateType — A CPhysicsPropCrateType_t. */
        crateType: number;
        /** CPhysicsProp/m_damageToEnableMotion */
        damageToEnableMotion: number;
        /** CPhysicsProp/m_damageType */
        damageType: number;
        /** CPhysicsProp/m_bDroppedByPlayer */
        droppedByPlayer: boolean;
        /** CPhysicsProp/m_nDynamicContinuousContactBehavior — A DynamicContinuousContactBehavior_t. */
        dynamicContinuousContactBehavior: number;
        /** CPhysicsProp/m_bEnableUseOutput */
        enableUseOutput: boolean;
        /** CPhysicsProp/m_bFirstCollisionAfterLaunch */
        firstCollisionAfterLaunch: boolean;
        /** CPhysicsProp/m_bForceNavIgnore */
        forceNavIgnore: boolean;
        /** CPhysicsProp/m_bForceNavObstacleCut */
        forceNavObstacleCut: boolean;
        /** CPhysicsProp/m_bForceNpcExclude */
        forceNpcExclude: boolean;
        /** CPhysicsProp/m_flForceToEnableMotion */
        forceToEnableMotion: number;
        /** CPhysicsProp/m_nGlowRange */
        glowRange: number;
        /** CPhysicsProp/m_nGlowRangeMin */
        glowRangeMin: number;
        /** CPhysicsProp/m_bHasBeenAwakened */
        hasBeenAwakened: boolean;
        /** CPhysicsProp/m_iInitialGlowState */
        initialGlowState: number;
        /** CPhysicsProp/m_bIsOverrideProp */
        isOverrideProp: boolean;
        /** CPhysicsProp/m_flLastBurn */
        lastBurn: number;
        /** CPhysicsProp/m_massScale */
        massScale: number;
        /** CPhysicsProp/m_bMuteImpactEffects */
        muteImpactEffects: boolean;
        /** CPhysicsProp/m_nNavObstacleType — A INavObstacleNavObstacleType_t. */
        navObstacleType: number;
        /** CPhysicsProp/m_fNextCheckDisableMotionContactsTime */
        nextCheckDisableMotionContactsTime: number;
        /** CPhysicsProp/m_bNoNavmeshBlocker */
        noNavmeshBlocker: boolean;
        /** CPhysicsProp/m_bRemovableForAmmoBalancing */
        removableForAmmoBalancing: boolean;
        /** CPhysicsProp/m_bShouldAutoConvertBackFromDebris */
        shouldAutoConvertBackFromDebris: boolean;
        /** CPhysicsProp/m_bThrownByPlayer */
        thrownByPlayer: boolean;
        /** CPhysicsProp/m_bTouchedByPlayer */
        touchedByPlayer: boolean;
        /** CPhysicsProp/m_bUpdateNavWhenMoving */
        updateNavWhenMoving: boolean;
    }

    /** The fields a CScriptTriggerHurt adds to CTriggerHurtRaw. */
    interface CScriptTriggerHurtRaw extends CTriggerHurtRaw {
    }

    /** The fields a CScriptTriggerMultiple adds to CTriggerMultipleRaw. */
    interface CScriptTriggerMultipleRaw extends CTriggerMultipleRaw {
    }

    /** The fields a CScriptTriggerPush adds to CTriggerPushRaw. */
    interface CScriptTriggerPushRaw extends CTriggerPushRaw {
    }

    /** The fields a CSmokeGrenadeProjectile adds to CBaseCSGrenadeProjectileRaw. */
    interface CSmokeGrenadeProjectileRaw extends CBaseCSGrenadeProjectileRaw {
        /** CSmokeGrenadeProjectile/m_bDidGroundScorch */
        didGroundScorch: boolean;
        /** CSmokeGrenadeProjectile/m_bDidSmokeEffect */
        didSmokeEffect: boolean;
        /** CSmokeGrenadeProjectile/m_bExplodeFromInferno */
        explodeFromInferno: boolean;
        /** CSmokeGrenadeProjectile/m_fllastSimulationTime */
        fllastSimulationTime: number;
        /** CSmokeGrenadeProjectile/m_flLastBounce */
        lastBounce: number;
        /** CSmokeGrenadeProjectile/m_nRandomSeed */
        randomSeed: number;
        /** CSmokeGrenadeProjectile/m_nSmokeEffectTickBegin */
        smokeEffectTickBegin: number;
        /** CSmokeGrenadeProjectile/m_nVoxelFrameDataSize */
        voxelFrameDataSize: number;
        /** CSmokeGrenadeProjectile/m_nVoxelUpdate */
        voxelUpdate: number;
    }

    /** The fields a CSoundOpvarSetOBBEntity adds to CSoundOpvarSetAABBEntityRaw. */
    interface CSoundOpvarSetOBBEntityRaw extends CSoundOpvarSetAABBEntityRaw {
    }

    /** The fields a CTriggerImpact adds to CTriggerMultipleRaw. */
    interface CTriggerImpactRaw extends CTriggerMultipleRaw {
        /** CTriggerImpact/m_flMagnitude */
        magnitude: number;
        /** CTriggerImpact/m_flNoise */
        noise: number;
        /** CTriggerImpact/m_flViewkick */
        viewkick: number;
    }

    /** The fields a CTriggerOnce adds to CTriggerMultipleRaw. */
    interface CTriggerOnceRaw extends CTriggerMultipleRaw {
    }

    /** The fields a CBaseCSGrenade adds to CCSWeaponBaseRaw. */
    interface CBaseCSGrenadeRaw extends CCSWeaponBaseRaw {
        /** CBaseCSGrenade/m_fDropTime */
        dropTime: number;
        /** CBaseCSGrenade/m_bIsHeldByPlayer */
        isHeldByPlayer: boolean;
        /** CBaseCSGrenade/m_bJumpThrow */
        jumpThrow: boolean;
        /** CBaseCSGrenade/m_bJustPulledPin */
        justPulledPin: boolean;
        /** CBaseCSGrenade/m_flNextHoldFrac */
        nextHoldFrac: number;
        /** CBaseCSGrenade/m_nNextHoldTick */
        nextHoldTick: number;
        /** CBaseCSGrenade/m_fPinPullTime */
        pinPullTime: number;
        /** CBaseCSGrenade/m_bPinPulled */
        pinPulled: boolean;
        /** CBaseCSGrenade/m_bRedraw */
        redraw: boolean;
        /** CBaseCSGrenade/m_hSwitchToWeaponAfterThrow — Another entity, or null when it points at nothing. Read-only. */
        readonly switchToWeaponAfterThrow: Entity<EntityRaw> | null;
        /** CBaseCSGrenade/m_bThrowAnimating */
        throwAnimating: boolean;
        /** CBaseCSGrenade/m_flThrowStrength */
        throwStrength: number;
        /** CBaseCSGrenade/m_fThrowTime */
        throwTime: number;
    }

    /** The fields a CBasePropDoor adds to CDynamicPropRaw. */
    interface CBasePropDoorRaw extends CDynamicPropRaw {
        /** CBasePropDoor/m_hActivator — Another entity, or null when it points at nothing. Read-only. */
        readonly activator: Entity<EntityRaw> | null;
        /** CBasePropDoor/m_flAutoReturnDelay */
        autoReturnDelay: number;
        /** CBasePropDoor/m_hBlocker — Another entity, or null when it points at nothing. Read-only. */
        readonly blocker: Entity<EntityRaw> | null;
        /** CBasePropDoor/m_eDoorState — A DoorState_t. */
        doorState: number;
        /** CBasePropDoor/m_bFirstBlocked */
        firstBlocked: boolean;
        /** CBasePropDoor/m_bForceClosed */
        forceClosed: boolean;
        /** CBasePropDoor/m_nHardwareType */
        hardwareType: number;
        /** CBasePropDoor/m_bLocked */
        locked: boolean;
        /** CBasePropDoor/m_hMaster — Another entity, or null when it points at nothing. Read-only. */
        readonly master: Entity<EntityRaw> | null;
        /** CBasePropDoor/m_bNeedsHardware */
        needsHardware: boolean;
        /** CBasePropDoor/m_bNoNPCs */
        noNPCs: boolean;
        /** CBasePropDoor/m_numCloseAttempts */
        numCloseAttempts: number;
        /** CBasePropDoor/m_SlaveName — Read-only, as every string field is. */
        readonly slaveName: string;
        /** CBasePropDoor/m_SoundClose — Read-only, as every string field is. */
        readonly soundClose: string;
        /** CBasePropDoor/m_SoundJiggle — Read-only, as every string field is. */
        readonly soundJiggle: string;
        /** CBasePropDoor/m_SoundLatch — Read-only, as every string field is. */
        readonly soundLatch: string;
        /** CBasePropDoor/m_SoundLock — Read-only, as every string field is. */
        readonly soundLock: string;
        /** CBasePropDoor/m_SoundLockedAnim — Read-only, as every string field is. */
        readonly soundLockedAnim: string;
        /** CBasePropDoor/m_SoundMoving — Read-only, as every string field is. */
        readonly soundMoving: string;
        /** CBasePropDoor/m_SoundOpen — Read-only, as every string field is. */
        readonly soundOpen: string;
        /** CBasePropDoor/m_SoundPound — Read-only, as every string field is. */
        readonly soundPound: string;
        /** CBasePropDoor/m_SoundUnlock — Read-only, as every string field is. */
        readonly soundUnlock: string;
        /** CBasePropDoor/m_flSpeed */
        speed: number;
    }

    /** The fields a CC4 adds to CCSWeaponBaseRaw. */
    interface CC4Raw extends CCSWeaponBaseRaw {
        /** CC4/m_fArmedTime */
        armedTime: number;
        /** CC4/m_bBombPlacedAnimation */
        bombPlacedAnimation: boolean;
        /** CC4/m_bBombPlanted */
        bombPlanted: boolean;
        /** CC4/m_bDoValidDroppedPositionCheck */
        doValidDroppedPositionCheck: boolean;
        /** CC4/m_bIsPlantingViaUse */
        isPlantingViaUse: boolean;
        /** CC4/m_nSpotRules */
        spotRules: number;
        /** CC4/m_bStartedArming */
        startedArming: boolean;
    }

    /** The fields a CCSObserverPawn adds to CCSPlayerPawnBaseRaw. */
    interface CCSObserverPawnRaw extends CCSPlayerPawnBaseRaw {
    }

    /** The fields a CCSPlayerPawn adds to CCSPlayerPawnBaseRaw. */
    interface PawnRaw extends CCSPlayerPawnBaseRaw {
        /** CCSPlayerPawn/m_allowAutoFollowTime */
        allowAutoFollowTime: number;
        /** CCSPlayerPawn/m_ArmorValue */
        armorValue: number;
        /** CCSPlayerPawn/m_iBlockingUseActionInProgress — A CSPlayerBlockingUseAction_t. */
        blockingUseActionInProgress: number;
        /** CCSPlayerPawn/m_bBotAllowActive */
        botAllowActive: boolean;
        /** CCSPlayerPawn/m_nCharacterDefIndex */
        characterDefIndex: number;
        /** CCSPlayerPawn/m_bCommittingSuicideOnTeamChange */
        committingSuicideOnTeamChange: boolean;
        /** CCSPlayerPawn/m_unCurrentEquipmentValue */
        currentEquipmentValue: number;
        /** CCSPlayerPawn/m_flDealtDamageToEnemyMostRecentTimestamp */
        dealtDamageToEnemyMostRecentTimestamp: number;
        /** CCSPlayerPawn/m_iDeathFlags */
        deathFlags: number;
        /** CCSPlayerPawn/m_flDeathInfoTime */
        deathInfoTime: number;
        /** CCSPlayerPawn/m_iDisplayHistoryBits */
        displayHistoryBits: number;
        /** CCSPlayerPawn/m_nEconGlovesChanged */
        econGlovesChanged: number;
        /** CCSPlayerPawn/m_flEmitSoundTime */
        emitSoundTime: number;
        /** CCSPlayerPawn/m_flFlinchStack */
        flinchStack: number;
        /** CCSPlayerPawn/m_unFreezetimeEndEquipmentValue */
        freezetimeEndEquipmentValue: number;
        /** CCSPlayerPawn/m_grenadeParameterStashTime */
        grenadeParameterStashTime: number;
        /** CCSPlayerPawn/m_bGrenadeParametersStashed */
        grenadeParametersStashed: boolean;
        /** CCSPlayerPawn/m_bGunGameImmunity */
        gunGameImmunity: boolean;
        /** CCSPlayerPawn/m_bHasDeathInfo */
        hasDeathInfo: boolean;
        /** CCSPlayerPawn/m_bHasFemaleVoice */
        hasFemaleVoice: boolean;
        /** CCSPlayerPawn/m_flHealthShotBoostExpirationTime */
        healthShotBoostExpirationTime: number;
        /** CCSPlayerPawn/m_ignoreLadderJumpTime */
        ignoreLadderJumpTime: number;
        /** CCSPlayerPawn/m_fImmuneToGunGameDamageTime */
        immuneToGunGameDamageTime: number;
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
        /** CCSPlayerPawn/m_nLastPickupPriority */
        lastPickupPriority: number;
        /** CCSPlayerPawn/m_flLastPickupPriorityTime */
        lastPickupPriorityTime: number;
        /** CCSPlayerPawn/m_szLastPlaceName — Read-only, as every string field is. */
        readonly lastPlaceName: string;
        /** CCSPlayerPawn/m_iLastWeaponFireUsercmd */
        lastWeaponFireUsercmd: number;
        /** CCSPlayerPawn/m_bLeftHanded */
        leftHanded: boolean;
        /** CCSPlayerPawn/m_fMolotovDamageTime */
        molotovDamageTime: number;
        /** CCSPlayerPawn/m_flNextSprayDecalTime */
        nextSprayDecalTime: number;
        /** CCSPlayerPawn/m_bNextSprayDecalTimeExpedited */
        nextSprayDecalTimeExpedited: boolean;
        /** CCSPlayerPawn/m_bOnGroundLastTick */
        onGroundLastTick: boolean;
        /** CCSPlayerPawn/m_iPlayerLocked */
        playerLocked: number;
        /** CCSPlayerPawn/m_nRagdollDamageBone */
        ragdollDamageBone: number;
        /** CCSPlayerPawn/m_bRagdollDamageHeadshot */
        ragdollDamageHeadshot: boolean;
        /** CCSPlayerPawn/m_szRagdollDamageWeaponName — Read-only, as every string field is. */
        readonly ragdollDamageWeaponName: string;
        /** CCSPlayerPawn/m_bResetArmorNextSpawn */
        resetArmorNextSpawn: boolean;
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
        /** CCSPlayerPawn/m_iShotsFired */
        shotsFired: number;
        /** CCSPlayerPawn/m_nSpotRules */
        spotRules: number;
        /** CCSPlayerPawn/m_strVOPrefix — Read-only, as every string field is. */
        readonly strVOPrefix: string;
        /** CCSPlayerPawn/m_fSwitchedHandednessTime */
        switchedHandednessTime: number;
        /** CCSPlayerPawn/m_flTimeOfLastInjury */
        timeOfLastInjury: number;
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
        /** CCSPlayerPawn/m_nWhichBombZone */
        whichBombZone: number;
    }

    /** The fields a CCSWeaponBaseGun adds to CCSWeaponBaseRaw. */
    interface CCSWeaponBaseGunRaw extends CCSWeaponBaseRaw {
        /** CCSWeaponBaseGun/m_iBurstShotsRemaining */
        burstShotsRemaining: number;
        /** CCSWeaponBaseGun/m_inPrecache */
        inPrecache: boolean;
        /** CCSWeaponBaseGun/m_bNeedsBoltAction */
        needsBoltAction: boolean;
        /** CCSWeaponBaseGun/m_nRevolverCylinderIdx */
        revolverCylinderIdx: number;
        /** CCSWeaponBaseGun/m_silencedModelIndex */
        silencedModelIndex: number;
        /** CCSWeaponBaseGun/m_bSkillBoltInterruptAvailable */
        skillBoltInterruptAvailable: boolean;
        /** CCSWeaponBaseGun/m_bSkillBoltLiftedFireKey */
        skillBoltLiftedFireKey: boolean;
        /** CCSWeaponBaseGun/m_bSkillReloadAvailable */
        skillReloadAvailable: boolean;
        /** CCSWeaponBaseGun/m_bSkillReloadLiftedReloadKey */
        skillReloadLiftedReloadKey: boolean;
        /** CCSWeaponBaseGun/m_zoomLevel */
        zoomLevel: number;
    }

    /** The fields a CCSWeaponBaseShotgun adds to CCSWeaponBaseRaw. */
    interface CCSWeaponBaseShotgunRaw extends CCSWeaponBaseRaw {
    }

    /** The fields a CChicken adds to CDynamicPropRaw. */
    interface CChickenRaw extends CDynamicPropRaw {
        /** CChicken/m_flActiveFollowStartTime */
        activeFollowStartTime: number;
        /** CChicken/m_currentActivity — A EChickenActivity. */
        currentActivity: number;
        /** CChicken/m_desiredActivity — A EChickenActivity. */
        desiredActivity: number;
        /** CChicken/m_fleeFrom — Another entity, or null when it points at nothing. Read-only. */
        readonly fleeFrom: Entity<EntityRaw> | null;
        /** CChicken/m_isOnGround */
        isOnGround: boolean;
        /** CChicken/m_flLastJumpTime */
        lastJumpTime: number;
        /** CChicken/m_leader — Another entity, or null when it points at nothing. Read-only. */
        readonly leader: Entity<EntityRaw> | null;
        /** CChicken/m_turnRate */
        turnRate: number;
    }

    /** The fields a CDynamicPropAlias_cable_dynamic adds to CDynamicPropRaw. */
    interface CDynamicPropAlias_cable_dynamicRaw extends CDynamicPropRaw {
    }

    /** The fields a CDynamicPropAlias_dynamic_prop adds to CDynamicPropRaw. */
    interface CDynamicPropAlias_dynamic_propRaw extends CDynamicPropRaw {
    }

    /** The fields a CDynamicPropAlias_prop_dynamic_override adds to CDynamicPropRaw. */
    interface CDynamicPropAlias_prop_dynamic_overrideRaw extends CDynamicPropRaw {
    }

    /** The fields a CFuncRetakeBarrier adds to CDynamicPropRaw. */
    interface CFuncRetakeBarrierRaw extends CDynamicPropRaw {
    }

    /** The fields a CFuncTrackChange adds to CFuncPlatRotRaw. */
    interface CFuncTrackChangeRaw extends CFuncPlatRotRaw {
        /** CFuncTrackChange/m_code — A TRAIN_CODE. */
        code: number;
        /** CFuncTrackChange/m_targetState */
        targetState: number;
        /** CFuncTrackChange/m_trackBottom — Another entity, or null when it points at nothing. Read-only. */
        readonly trackBottom: Entity<EntityRaw> | null;
        /** CFuncTrackChange/m_trackBottomName — Read-only, as every string field is. */
        readonly trackBottomName: string;
        /** CFuncTrackChange/m_trackTop — Another entity, or null when it points at nothing. Read-only. */
        readonly trackTop: Entity<EntityRaw> | null;
        /** CFuncTrackChange/m_trackTopName — Read-only, as every string field is. */
        readonly trackTopName: string;
        /** CFuncTrackChange/m_train — Another entity, or null when it points at nothing. Read-only. */
        readonly train: Entity<EntityRaw> | null;
        /** CFuncTrackChange/m_trainName — Read-only, as every string field is. */
        readonly trainName: string;
        /** CFuncTrackChange/m_use */
        use: number;
    }

    /** The fields a CHostageAlias_info_hostage_spawn adds to CHostageRaw. */
    interface CHostageAlias_info_hostage_spawnRaw extends CHostageRaw {
    }

    /** The fields a CKnife adds to CCSWeaponBaseRaw. */
    interface CKnifeRaw extends CCSWeaponBaseRaw {
        /** CKnife/m_bFirstAttack */
        firstAttack: boolean;
    }

    /** The fields a COrnamentProp adds to CDynamicPropRaw. */
    interface COrnamentPropRaw extends CDynamicPropRaw {
        /** COrnamentProp/m_initialOwner — Read-only, as every string field is. */
        readonly initialOwner: string;
    }

    /** The fields a CPhysicsPropMultiplayer adds to CPhysicsPropRaw. */
    interface CPhysicsPropMultiplayerRaw extends CPhysicsPropRaw {
    }

    /** The fields a CPhysicsPropOverride adds to CPhysicsPropRaw. */
    interface CPhysicsPropOverrideRaw extends CPhysicsPropRaw {
    }

    /** The fields a CPhysicsPropRespawnable adds to CPhysicsPropRaw. */
    interface CPhysicsPropRespawnableRaw extends CPhysicsPropRaw {
        /** CPhysicsPropRespawnable/m_flRespawnDuration */
        respawnDuration: number;
    }

    /** The fields a CScriptTriggerOnce adds to CTriggerOnceRaw. */
    interface CScriptTriggerOnceRaw extends CTriggerOnceRaw {
    }

    /** The fields a CTriggerLook adds to CTriggerOnceRaw. */
    interface CTriggerLookRaw extends CTriggerOnceRaw {
        /** CTriggerLook/m_b2DFOV */
        b2DFOV: boolean;
        /** CTriggerLook/m_flFieldOfView */
        fieldOfView: number;
        /** CTriggerLook/m_bIsLooking */
        isLooking: boolean;
        /** CTriggerLook/m_hLookTarget — Another entity, or null when it points at nothing. Read-only. */
        readonly lookTarget: Entity<EntityRaw> | null;
        /** CTriggerLook/m_flLookTime */
        lookTime: number;
        /** CTriggerLook/m_flLookTimeLast */
        lookTimeLast: number;
        /** CTriggerLook/m_flLookTimeTotal */
        lookTimeTotal: number;
        /** CTriggerLook/m_bTestAllVisibleOcclusion */
        testAllVisibleOcclusion: boolean;
        /** CTriggerLook/m_bTestOcclusion */
        testOcclusion: boolean;
        /** CTriggerLook/m_flTimeoutDuration */
        timeoutDuration: number;
        /** CTriggerLook/m_bTimeoutFired */
        timeoutFired: boolean;
        /** CTriggerLook/m_bUseVelocity */
        useVelocity: boolean;
    }

    /** The fields a CWeaponBaseItem adds to CCSWeaponBaseRaw. */
    interface CWeaponBaseItemRaw extends CCSWeaponBaseRaw {
        /** CWeaponBaseItem/m_bRedraw */
        redraw: boolean;
        /** CWeaponBaseItem/m_bSequenceInProgress */
        sequenceInProgress: boolean;
    }

    /** The fields a CAK47 adds to CCSWeaponBaseGunRaw. */
    interface CAK47Raw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CDEagle adds to CCSWeaponBaseGunRaw. */
    interface CDEagleRaw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CDecoyGrenade adds to CBaseCSGrenadeRaw. */
    interface CDecoyGrenadeRaw extends CBaseCSGrenadeRaw {
    }

    /** The fields a CFlashbang adds to CBaseCSGrenadeRaw. */
    interface CFlashbangRaw extends CBaseCSGrenadeRaw {
    }

    /** The fields a CFuncTrackAuto adds to CFuncTrackChangeRaw. */
    interface CFuncTrackAutoRaw extends CFuncTrackChangeRaw {
    }

    /** The fields a CHEGrenade adds to CBaseCSGrenadeRaw. */
    interface CHEGrenadeRaw extends CBaseCSGrenadeRaw {
    }

    /** The fields a CItem_Healthshot adds to CWeaponBaseItemRaw. */
    interface CItem_HealthshotRaw extends CWeaponBaseItemRaw {
    }

    /** The fields a CMolotovGrenade adds to CBaseCSGrenadeRaw. */
    interface CMolotovGrenadeRaw extends CBaseCSGrenadeRaw {
    }

    /** The fields a CPropDoorRotating adds to CBasePropDoorRaw. */
    interface CPropDoorRotatingRaw extends CBasePropDoorRaw {
        /** CPropDoorRotating/m_flAjarAngle */
        ajarAngle: number;
        /** CPropDoorRotating/m_bAjarDoorShouldntAlwaysOpen */
        ajarDoorShouldntAlwaysOpen: boolean;
        /** CPropDoorRotating/m_eCurrentOpenDirection — A PropDoorRotatingOpenDirection_e. */
        currentOpenDirection: number;
        /** CPropDoorRotating/m_eDefaultCheckDirection — A doorCheck_e. */
        defaultCheckDirection: number;
        /** CPropDoorRotating/m_flDistance */
        distance: number;
        /** CPropDoorRotating/m_hEntityBlocker — Another entity, or null when it points at nothing. Read-only. */
        readonly entityBlocker: Entity<EntityRaw> | null;
        /** CPropDoorRotating/m_eOpenDirection — A PropDoorRotatingOpenDirection_e. */
        openDirection: number;
        /** CPropDoorRotating/m_eSpawnPosition — A PropDoorRotatingSpawnPos_t. */
        spawnPosition: number;
    }

    /** The fields a CSmokeGrenade adds to CBaseCSGrenadeRaw. */
    interface CSmokeGrenadeRaw extends CBaseCSGrenadeRaw {
    }

    /** The fields a CWeaponAWP adds to CCSWeaponBaseGunRaw. */
    interface CWeaponAWPRaw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponAug adds to CCSWeaponBaseGunRaw. */
    interface CWeaponAugRaw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponBizon adds to CCSWeaponBaseGunRaw. */
    interface CWeaponBizonRaw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponCZ75a adds to CCSWeaponBaseGunRaw. */
    interface CWeaponCZ75aRaw extends CCSWeaponBaseGunRaw {
        /** CWeaponCZ75a/m_bMagazineRemoved */
        magazineRemoved: boolean;
    }

    /** The fields a CWeaponElite adds to CCSWeaponBaseGunRaw. */
    interface CWeaponEliteRaw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponFamas adds to CCSWeaponBaseGunRaw. */
    interface CWeaponFamasRaw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponFiveSeven adds to CCSWeaponBaseGunRaw. */
    interface CWeaponFiveSevenRaw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponG3SG1 adds to CCSWeaponBaseGunRaw. */
    interface CWeaponG3SG1Raw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponGalilAR adds to CCSWeaponBaseGunRaw. */
    interface CWeaponGalilARRaw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponGlock adds to CCSWeaponBaseGunRaw. */
    interface CWeaponGlockRaw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponHKP2000 adds to CCSWeaponBaseGunRaw. */
    interface CWeaponHKP2000Raw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponM249 adds to CCSWeaponBaseGunRaw. */
    interface CWeaponM249Raw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponM4A1 adds to CCSWeaponBaseGunRaw. */
    interface CWeaponM4A1Raw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponM4A1Silencer adds to CCSWeaponBaseGunRaw. */
    interface CWeaponM4A1SilencerRaw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponMAC10 adds to CCSWeaponBaseGunRaw. */
    interface CWeaponMAC10Raw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponMP5SD adds to CCSWeaponBaseGunRaw. */
    interface CWeaponMP5SDRaw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponMP7 adds to CCSWeaponBaseGunRaw. */
    interface CWeaponMP7Raw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponMP9 adds to CCSWeaponBaseGunRaw. */
    interface CWeaponMP9Raw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponMag7 adds to CCSWeaponBaseGunRaw. */
    interface CWeaponMag7Raw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponNOVA adds to CCSWeaponBaseShotgunRaw. */
    interface CWeaponNOVARaw extends CCSWeaponBaseShotgunRaw {
    }

    /** The fields a CWeaponNegev adds to CCSWeaponBaseGunRaw. */
    interface CWeaponNegevRaw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponP250 adds to CCSWeaponBaseGunRaw. */
    interface CWeaponP250Raw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponP90 adds to CCSWeaponBaseGunRaw. */
    interface CWeaponP90Raw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponRevolver adds to CCSWeaponBaseGunRaw. */
    interface CWeaponRevolverRaw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponSCAR20 adds to CCSWeaponBaseGunRaw. */
    interface CWeaponSCAR20Raw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponSG556 adds to CCSWeaponBaseGunRaw. */
    interface CWeaponSG556Raw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponSSG08 adds to CCSWeaponBaseGunRaw. */
    interface CWeaponSSG08Raw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponSawedoff adds to CCSWeaponBaseShotgunRaw. */
    interface CWeaponSawedoffRaw extends CCSWeaponBaseShotgunRaw {
    }

    /** The fields a CWeaponTaser adds to CCSWeaponBaseGunRaw. */
    interface CWeaponTaserRaw extends CCSWeaponBaseGunRaw {
        /** CWeaponTaser/m_fFireTime */
        fireTime: number;
        /** CWeaponTaser/m_nLastAttackTick */
        lastAttackTick: number;
    }

    /** The fields a CWeaponTec9 adds to CCSWeaponBaseGunRaw. */
    interface CWeaponTec9Raw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponUMP45 adds to CCSWeaponBaseGunRaw. */
    interface CWeaponUMP45Raw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponUSPSilencer adds to CCSWeaponBaseGunRaw. */
    interface CWeaponUSPSilencerRaw extends CCSWeaponBaseGunRaw {
    }

    /** The fields a CWeaponXM1014 adds to CCSWeaponBaseShotgunRaw. */
    interface CWeaponXM1014Raw extends CCSWeaponBaseShotgunRaw {
    }

    /** The fields a CIncendiaryGrenade adds to CMolotovGrenadeRaw. */
    interface CIncendiaryGrenadeRaw extends CMolotovGrenadeRaw {
    }

    /** The fields a CPropDoorRotatingBreakable adds to CPropDoorRotatingRaw. */
    interface CPropDoorRotatingBreakableRaw extends CPropDoorRotatingRaw {
        /** CPropDoorRotatingBreakable/m_bBreakable */
        breakable: boolean;
        /** CPropDoorRotatingBreakable/m_currentDamageState */
        currentDamageState: number;
        /** CPropDoorRotatingBreakable/m_isAbleToCloseAreaPortals */
        isAbleToCloseAreaPortals: boolean;
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

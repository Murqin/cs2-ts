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
        /** What this is: "pawn", "controller". */
        readonly kind: string;

        /**
         * Whether the entity is still there — the player is on the server and, for a
         * pawn, in the world. Cheap, and never throws.
         */
        readonly isValid: boolean;

        /** Every field the entity has, by name. Throws once the entity is gone. */
        readonly raw: TRaw;

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
        /** CBasePlayerController/m_nInButtonsWhichAreToggles — A 64-bit value, as a string: it does not survive a JavaScript number. */
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
        /** CCSPlayerController/m_nPlayerDominated — A 64-bit value, as a string: it does not survive a JavaScript number. */
        readonly playerDominated: string;
        /** CCSPlayerController/m_nPlayerDominatingMe — A 64-bit value, as a string: it does not survive a JavaScript number. */
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
        /** CBasePlayerController/m_steamID — A 64-bit value, as a string: it does not survive a JavaScript number. */
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

    /** Handler signatures for the events the runtime dispatches. */
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

        round_start: (timeLimit: number) => void;
        round_end: (winner: number) => void;
        player_connect: (player: Player) => void;
        player_disconnect: (player: Player) => void;
        player_death: (player: Player) => void;
        player_spawn: (player: Player) => void;
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

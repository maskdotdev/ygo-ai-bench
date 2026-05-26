import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
// Restore ownership: "test/lua-real-script-evilswarm-bahamut-detach-discard-control.test.ts"
// Restore ownership: "test/lua-real-script-metaphys-horus-synchro-material-control.test.ts"
// Restore ownership: "test/lua-real-script-zombie-necronize-control-grave-set.test.ts"
// Restore ownership: "test/lua-real-script-abduction-banish-control.test.ts"
// Restore ownership: "test/lua-real-script-alien-hypno-gemini-counter-control.test.ts"
// Restore ownership: "test/lua-real-script-altergeist-adminia-cost-control-setcode.test.ts"
// Restore ownership: "test/lua-real-script-amanokujaki-quick-control-attribute.test.ts"
// Restore ownership: "test/lua-real-script-amaze-attraction-viking-vortex-attack-control.test.ts"
// Restore ownership: "test/lua-real-script-archfiends-advent-sarcophagus-summon-control-stat.test.ts"
// Restore ownership: "test/lua-real-script-armityle-phantom-fury-control-end-summon.test.ts"
// Restore ownership: "test/lua-real-script-baytal-hecahands-release-control-end-send.test.ts"
// Restore ownership: "test/lua-real-script-big-eye-detach-control-lock.test.ts"
// Restore ownership: "test/lua-real-script-brain-jacker-flip-equip-recover.test.ts"
// Restore ownership: "test/lua-real-script-brainwashing-beam-counter-control.test.ts"
// Restore ownership: "test/lua-real-script-bystial-aluber-summon-discard-control-revive.test.ts"
// Restore ownership: "test/lua-real-script-centerfrog-position-control.test.ts"
// Restore ownership: "test/lua-real-script-chthonian-polymer-fusion-release-control.test.ts"
// Restore ownership: "test/lua-real-script-comic-hand-toon-control.test.ts"
// Restore ownership: "test/lua-real-script-crackdown-persistent-control-lock.test.ts"
// Restore ownership: "test/lua-real-script-creature-seizure-normal-swap.test.ts"
// Restore ownership: "test/lua-real-script-cyber-angel-natasha-recover-negate-control.test.ts"
// Restore ownership: "test/lua-real-script-dark-necrofear-procedure-equip.test.ts"
// Restore ownership: "test/lua-real-script-darklord-enchantment-cost-control.test.ts"
// Restore ownership: "test/lua-real-script-dd-guide-summon-control-end-banish.test.ts"
// Restore ownership: "test/lua-real-script-ddd-headhunt-control-disable-setcode.test.ts"
// Restore ownership: "test/lua-real-script-double-magical-arm-bind-release-control.test.ts"
// Restore ownership: "test/lua-real-script-dummy-golem-flip-opponent-swap.test.ts"
// Restore ownership: "test/lua-real-script-embrace-tistina-chain-set-control.test.ts"
// Restore ownership: "test/lua-real-script-enlilgirsu-banished-return-deck-control.test.ts"
// Restore ownership: "test/lua-real-script-eternal-bond-revive-control-attack-lock.test.ts"
// Restore ownership: "test/lua-real-script-eulers-circuit-field-control-search.test.ts"
// Restore ownership: "test/lua-real-script-evil-eye-mesmerism-persistent-control.test.ts"
// Restore ownership: "test/lua-real-script-evil-hero-neos-lord-summon-grave-control-protect.test.ts"
// Restore ownership: "test/lua-real-script-evil-twin-present-swap-todeck.test.ts"
// Restore ownership: "test/lua-real-script-eye-illusion-select-control.test.ts"
// Restore ownership: "test/lua-real-script-giant-ballgame-activate-summon-swap-race.test.ts"
// Restore ownership: "test/lua-real-script-galaxy-eyes-cipher-dragon-detach-control-stat-code.test.ts"
// Restore ownership: "test/lua-real-script-geonator-transverser-linked-swap-protect.test.ts"
// Restore ownership: "test/lua-real-script-gladiator-taming-select-position-control.test.ts"
// Restore ownership: "test/lua-real-script-gotterdammerung-control-end-banish.test.ts"
// Restore ownership: "test/lua-real-script-goyo-emperor-battle-revive.test.ts"
// Restore ownership: "test/lua-real-script-heartfelt-appeal-direct-damage-control.test.ts"
// Restore ownership: "test/lua-real-script-hecahands-dandalos-control-direct.test.ts"
// Restore ownership: "test/lua-real-script-hecahands-xeno-extra-summon.test.ts"
// Restore ownership: "test/lua-real-script-illegal-knight-quick-summon-control-tohand.test.ts"
// Restore ownership: "test/lua-real-script-intercept-tribute-material-control.test.ts"
// Restore ownership: "test/lua-real-script-interplanetary-invader-a-battle-start-control.test.ts"
// Restore ownership: "test/lua-real-script-invader-throne-flip-swap-control.test.ts"
// Restore ownership: "test/lua-real-script-jowls-flip-control-direct.test.ts"
// Restore ownership: "test/lua-real-script-libromancer-displaced-control-return.test.ts"
// Restore ownership: "test/lua-real-script-magi-magi-detach-banish-control.test.ts"
// Restore ownership: "test/lua-real-script-magic-gate-miracles-position-control-protect.test.ts"
// Restore ownership: "test/lua-real-script-mark-rose-equip-control.test.ts"
// Restore ownership: "test/lua-real-script-neo-galaxy-eyes-cipher-dragon-detach-group-control-stat-code.test.ts"
// Restore ownership: "test/lua-real-script-missing-force-release-control-lock.test.ts"
// Restore ownership: "test/lua-real-script-mind-pollutant-discard-level-control.test.ts"
// Restore ownership: "test/lua-real-script-mimighoul-armor-battle-protect-control-summon.test.ts"
// Restore ownership: "test/lua-real-script-mimighoul-cerberus-flip-control.test.ts"
// Restore ownership: "test/lua-real-script-mimighoul-fairy-lock-control-summon.test.ts"
// Restore ownership: "test/lua-real-script-mimighoul-flower-flip-select-summon.test.ts"
// Restore ownership: "test/lua-real-script-mimighoul-slime-flip-deck-summon-control.test.ts"
// Restore ownership: "test/lua-real-script-musical-sumo-dice-games-battle-move.test.ts"
// Restore ownership: "test/lua-real-script-naturia-fruitfly-defense-control.test.ts"
// Restore ownership: "test/lua-real-script-number-46-dragluon-selecteffect-summon.test.ts"
// Restore ownership: "test/lua-real-script-oath-companionship-extra-control-special-lock.test.ts"
// Restore ownership: "test/lua-real-script-old-entity-hastorr-grave-equip-control.test.ts"
// Restore ownership: "test/lua-real-script-owners-seal-field-control-return.test.ts"
// Restore ownership: "test/lua-real-script-packet-swap-link-control.test.ts"
// Restore ownership: "test/lua-real-script-photon-hand-galaxy-control.test.ts"
// Restore ownership: "test/lua-real-script-possessed-resonance-wynn-control-todeck.test.ts"
// Restore ownership: "test/lua-real-script-rebellion-battle-control-attack-lock.test.ts"
// Restore ownership: "test/lua-real-script-release-brainwashing-release-control.test.ts"
// Restore ownership: "test/lua-real-script-rikka-sheet-release-control-race.test.ts"
// Restore ownership: "test/lua-real-script-rum-revolution-force-rankup-overlay.test.ts"
// Restore ownership: "test/lua-real-script-sage-ciela-discard-control-revive-tohand.test.ts"
// Restore ownership: "test/lua-real-script-seleglare-no-tribute-control.test.ts"
// Restore ownership: "test/lua-real-script-service-puppet-play-control-grave-summon.test.ts"
// Restore ownership: "test/lua-real-script-shiens-spy-give-control-return.test.ts"
// Restore ownership: "test/lua-real-script-splash-capture-xyz-banish-control.test.ts"
// Restore ownership: "test/lua-real-script-spright-double-cross-overlay.test.ts"
// Restore ownership: "test/lua-real-script-spyral-mission-recapture-activate-control-replace.test.ts"
// Restore ownership: "test/lua-real-script-subterror-voltelluric-position-summon.test.ts"
// Restore ownership: "test/lua-real-script-synchro-control-opponent-turn-return.test.ts"
// Restore ownership: "test/lua-real-script-tragoedia-damage-summon-control-stat.test.ts"
// Restore ownership: "test/lua-real-script-trick-box-destroyed-control-summon-return.test.ts"
// Restore ownership: "test/lua-real-script-tuners-scheme-synchro-control-redirect.test.ts"
// Restore ownership: "test/lua-real-script-two-toads-equip-summon-destroy.test.ts"
// Restore ownership: "test/lua-real-script-ursarctic-big-dipper-counter-control.test.ts"
// Restore ownership: "test/lua-real-script-utopic-draco-future-negate-control.test.ts"
// Restore ownership: "test/lua-real-script-utopic-future-damage-step-control-replace.test.ts"
// Restore ownership: "test/lua-real-script-utopic-future-zexal-chain-control-protect-stat.test.ts"
// Restore ownership: "test/lua-real-script-vampire-fascinator-release-control.test.ts"
// Restore ownership: "test/lua-real-script-vampire-red-baron-swap-revive.test.ts"
// Restore ownership: "test/lua-real-script-vaylantz-duke-facedown-lock.test.ts"
// Restore ownership: "test/lua-real-script-vera-control-earth-summon.test.ts"
// Restore ownership: "test/lua-real-script-vs-hollie-sue-reveal-control.test.ts"
// Restore ownership: "test/lua-real-script-alien-brain-battle-destroyed-control-race.test.ts"
const controlFixtureCount = 53;
const controlKindCounts = {
  battleDestroyedTrapControlRace: 1,
  battleStartPhaseControl: 1,
  damageStepBattleControlReplace: 1,
  chainDetachControlProtectStat: 1,
  battleCounterControl: 2,
  chainControlSummon: 1,
  chainControlToken: 1,
  cannotChangeControl: 1,
  confirmDamageGroupControl: 1,
  detachGroupControlStatCode: 1,
  detachControlStatCode: 1,
  fusionSummonReleaseCostControl: 1,
  geminiCounterControlEndDestroy: 1,
  detachControlReleaseDestroy: 1,
  discardCostTemporaryControl: 2,
  equipControl: 1,
  flipDestroyControlSearch: 1,
  flipGetControl: 2,
  flipSetControl: 1,
  groupSwapControl: 1,
  linkedZoneControlRevive: 1,
  linkedGroupSwapProtect: 1,
  ownedControlAttackDrain: 1,
  phaseEndSelfControl: 5,
  pzoneDestroyControlDamage: 1,
  releaseCostControl: 3,
  releaseCostActivityLockedControl: 1,
  restrictedTemporaryControl: 2,
  searchDestroyGraveControl: 1,
  selectedPermanentControl: 1,
  selfDiscardTemporaryControl: 1,
  selfToGraveAttributeControl: 1,
  summonTriggerTemporaryControl: 1,
  summonAndGraveTriggerControlProtect: 1,
  summonProcControlAttackLockStat: 1,
  linkedLpCostControlDelayedDestroy: 1,
  swapControlLock: 1,
  targetedSwapControl: 4,
  temporaryControl: 1,
  xyzSummonBanishCostControl: 1,
} satisfies Record<ControlKind, number>;
const controlSemanticVariantCounts = {
  allyEnemyCatcherSummonControlReturn: 1,
  brainControlLpCostReturn: 1,
  changeHeartTemporaryReturn: 1,
  creatureSwapControlLock: 1,
  dharcFlipSetControl: 1,
  electromagneticBagwormOpponentTurnControl: 1,
  electricVirusDiscardControl: 1,
  enemyControllerReleaseControl: 1,
  ashenedEternityOwnedControlAttackDrain: 1,
  matazaCannotChangeControl: 1,
  mindControlRestrictions: 1,
  rafflesiaFlipGetControl: 1,
  snatchStealEquipControl: 1,
  suppressionPlutoAnnounceControl: 1,
  xyzReversalTargetedSwapControl: 1,
  yummyRedemptionGraveSwapControl: 1,
} satisfies Record<ControlSemanticVariant, number>;

type ControlKind =
  | "battleDestroyedTrapControlRace"
  | "battleStartPhaseControl"
  | "damageStepBattleControlReplace"
  | "chainDetachControlProtectStat"
  | "battleCounterControl"
  | "chainControlSummon"
  | "chainControlToken"
  | "cannotChangeControl"
  | "confirmDamageGroupControl"
  | "detachGroupControlStatCode"
  | "detachControlStatCode"
  | "fusionSummonReleaseCostControl"
  | "geminiCounterControlEndDestroy"
  | "detachControlReleaseDestroy"
  | "discardCostTemporaryControl"
  | "equipControl"
  | "flipDestroyControlSearch"
  | "flipGetControl"
  | "flipSetControl"
  | "groupSwapControl"
  | "linkedZoneControlRevive"
  | "linkedGroupSwapProtect"
  | "ownedControlAttackDrain"
  | "phaseEndSelfControl"
  | "pzoneDestroyControlDamage"
  | "releaseCostControl"
  | "releaseCostActivityLockedControl"
  | "restrictedTemporaryControl"
  | "searchDestroyGraveControl"
  | "selectedPermanentControl"
  | "selfDiscardTemporaryControl"
  | "selfToGraveAttributeControl"
  | "summonTriggerTemporaryControl"
  | "summonAndGraveTriggerControlProtect"
  | "summonProcControlAttackLockStat"
  | "linkedLpCostControlDelayedDestroy"
  | "swapControlLock"
  | "targetedSwapControl"
  | "temporaryControl"
  | "xyzSummonBanishCostControl";

type ControlSemanticVariant =
  | "allyEnemyCatcherSummonControlReturn"
  | "brainControlLpCostReturn"
  | "changeHeartTemporaryReturn"
  | "creatureSwapControlLock"
  | "dharcFlipSetControl"
  | "electromagneticBagwormOpponentTurnControl"
  | "electricVirusDiscardControl"
  | "enemyControllerReleaseControl"
  | "ashenedEternityOwnedControlAttackDrain"
  | "matazaCannotChangeControl"
  | "mindControlRestrictions"
  | "rafflesiaFlipGetControl"
  | "snatchStealEquipControl"
  | "suppressionPlutoAnnounceControl"
  | "xyzReversalTargetedSwapControl"
  | "yummyRedemptionGraveSwapControl";

describe("Lua real control restore coverage", () => {
  it("requires representative control-change fixtures to prove clean Lua restore and replayed legal actions", () => {
    const files = realScriptControlFixtureFiles();
    expect(files).toHaveLength(controlFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("previousController")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps control fixture kinds explicit", () => {
    expect(countControlKinds(realScriptControlFixtureFiles())).toEqual(controlKindCounts);
  });

  it("keeps named control semantic variants explicit", () => {
    expect(countControlSemanticVariants(realScriptControlSemanticVariants())).toEqual(controlSemanticVariantCounts);

    const weak = realScriptControlSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function realScriptControlFixtureFiles(): Array<{
  file: string;
  kind: ControlKind;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-alien-brain-battle-destroyed-control-race.test.ts",
      kind: "battleDestroyedTrapControlRace",
      required: [
        "restores battle-destroyed Reptile trigger into destroyer control and race change",
        "e1:SetCode(EVENT_BATTLE_DESTROYED)",
        "ec==Duel.GetAttackTarget()",
        "local tc=eg:GetFirst():GetReasonCard()",
        "Duel.GetControl(tc,tp)",
        "e1:SetCode(EFFECT_CHANGE_RACE)",
        'eventName: "battleDestroyed"',
        'eventName: "controlChanged"',
        "currentRace(controlledAttacker, restoredTrigger.session.state)).toBe(raceReptile)",
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-interplanetary-invader-a-battle-start-control.test.ts",
      kind: "battleStartPhaseControl",
      required: [
        'const invaderCode = "14729426"',
        '--Interplanetary Invader "A"',
        "e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)",
        "e1:SetCode(EVENT_BATTLE_START)",
        "e:GetHandler()==Duel.GetAttackTarget()",
        "local a=Duel.GetAttacker()",
        "e1:SetCategory(CATEGORY_CONTROL)",
        "e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)",
        "e1:SetCode(EVENT_PHASE|PHASE_BATTLE)",
        "e1:SetLabelObject(a)",
        "Duel.RegisterEffect(e1,tp)",
        "Duel.SetTargetCard(a)",
        "Duel.GetControl(tc,tp)",
        'eventName: "battleStarted"',
        'eventName: "phaseBattle"',
        'eventName: "controlChanged"',
        "previousController: 0",
      ],
    },
    {
      file: "lua-real-script-borreload-liberator-linked-control-revive.test.ts",
      kind: "linkedZoneControlRevive",
      required: [
        "restores battle-phase linked-zone control and GY destroy-then-self-summon",
        "Duel.GetControl(g,tp,0,0,zones)",
        "Duel.SetChainLimit(function(e,ep,tp) return tp==ep end)",
        "Duel.Destroy(tc,REASON_EFFECT)>0",
        "Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)",
        'eventName: "controlChanged"',
        'eventName: "specialSummoned"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-bot-herder-confirm-damage-control.test.ts",
      kind: "confirmDamageGroupControl",
      required: [
        "restores face-down confirmation into opponent damage and group control transfer",
        "--Bot Herder",
        "e1:SetCategory(CATEGORY_DAMAGE+CATEGORY_CONTROL)",
        "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
        "return (c:IsOwner(tp) and c:IsFaceup()) or c:IsPosition(POS_FACEDOWN_DEFENSE)",
        "Duel.SelectTarget(tp,s.efftgfilter,tp,0,LOCATION_MZONE,1,1,nil,tp)",
        "Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,200)",
        "Duel.SetPossibleOperationInfo(0,CATEGORY_CONTROL,nil,1,1-tp,LOCATION_MZONE)",
        "if tc:IsFacedown() then Duel.ConfirmCards(tp,tc) end",
        "Duel.Damage(1-tp,200,REASON_EFFECT)",
        "Duel.GetControl(g,tp)",
        "confirmed 0:",
        'eventName: "confirmed"',
        'eventName: "damageDealt"',
        'eventName: "controlChanged"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-chaotic-elements-search-destroy-control.test.ts",
      kind: "searchDestroyGraveControl",
      required: [
        "restores search plus optional destruction and grave SelfBanish temporary control",
        "e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH+CATEGORY_DESTROY)",
        "Duel.SelectYesNo(tp,aux.Stringid(id,2))",
        "e2:SetCategory(CATEGORY_CONTROL)",
        "e2:SetCost(Cost.SelfBanish)",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
        'eventName: "banished"',
        'eventName: "controlChanged"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-jinzo-layered-detach-control-release-destroy.test.ts",
      kind: "detachControlReleaseDestroy",
      required: [
        "restores Xyz detach control locks and Trap-gated release destruction",
        "--Jinzo - Layered",
        "Xyz.AddProcedure(c,nil,6,2)",
        "e1:SetCategory(CATEGORY_CONTROL)",
        "e1:SetCost(Cost.DetachFromSelf(1))",
        "Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsControlerCanBeChanged),tp,0,LOCATION_MZONE,1,1,nil)",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
        "e1:SetCode(EFFECT_CANNOT_TRIGGER)",
        "e2:SetCode(EFFECT_CANNOT_ATTACK)",
        "e2:SetCategory(CATEGORY_RELEASE+CATEGORY_DESTROY)",
        "Duel.Release(rg,REASON_EFFECT)",
        "Duel.Destroy(dg,REASON_EFFECT)",
        'eventName: "detachedMaterial"',
        'eventName: "controlChanged"',
        'eventName: "released"',
        'eventName: "destroyed"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-galaxy-eyes-cipher-dragon-detach-control-stat-code.test.ts",
      kind: "detachControlStatCode",
      required: [
        "restores detach control into disable, final ATK, code change, and direct-attack lock",
        'const cipherCode = "18963306"',
        "--Galaxy-Eyes Cipher Dragon",
        "Xyz.AddProcedure(c,nil,8,2)",
        "e1:SetCategory(CATEGORY_CONTROL)",
        "e1:SetCost(Cost.DetachFromSelf(1))",
        "Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
        "Duel.NegateRelatedChain(tc,RESET_TURN_SET)",
        "e1:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)",
        "e2:SetCode(EFFECT_DISABLE)",
        "e3:SetCode(EFFECT_DISABLE_EFFECT)",
        "e4:SetCode(EFFECT_SET_ATTACK_FINAL)",
        "e5:SetCode(EFFECT_CHANGE_CODE)",
        "e:GetHandler():GetCardEffect(EFFECT_SET_CONTROL)",
        'eventName: "detachedMaterial"',
        'eventName: "becameTarget"',
        'eventName: "controlChanged"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-neo-galaxy-eyes-cipher-dragon-detach-group-control-stat-code.test.ts",
      kind: "detachGroupControlStatCode",
      required: [
        "restores variable detach count into operated-group control, negate, final ATK, code change, and direct-attack lock",
        'const neoCipherCode = "12632096"',
        "--Neo Galaxy-Eyes Cipher Dragon",
        "Xyz.AddProcedure(c,nil,9,3)",
        "e:GetHandler():GetOverlayGroup():IsExists(Card.IsSetCard,1,nil,SET_CIPHER)",
        "e1:SetCost(Cost.DetachFromSelf(1,s.ctcostmax,function(e,og) e:SetLabel(#og) end))",
        "Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsAbleToChangeControler),tp,0,LOCATION_MZONE,nil)",
        "Duel.GetLocationCount(tp,LOCATION_MZONE,tp,LOCATION_REASON_CONTROL)",
        "Duel.SelectMatchingCard(tp,aux.FaceupFilter(Card.IsAbleToChangeControler),tp,0,LOCATION_MZONE,ct,ct,nil)",
        "Duel.GetControl(g,tp,PHASE_END,1)",
        "Duel.GetOperatedGroup()",
        "tc:NegateEffects(c,RESET_CONTROL)",
        "e1:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)",
        "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
        "e2:SetCode(EFFECT_CHANGE_CODE)",
        'eventName: "detachedMaterial"',
        'eventName: "controlChanged"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-geonator-transverser-linked-swap-protect.test.ts",
      kind: "linkedGroupSwapProtect",
      required: [
        'const geonatorCode = "52119435"',
        "--Geonator Transverser",
        "restores cross-controller linked group targeting into SwapControl and linked effect destruction protection",
        "Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsType,TYPE_EFFECT),2)",
        "e1:SetProperty(EFFECT_FLAG_SET_AVAILABLE)",
        "e1:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)",
        "e1:SetValue(aux.indoval)",
        "e:GetHandler():GetLinkedGroupCount()==2",
        "g:FilterCount(Card.IsAbleToChangeControler,nil)==2",
        "Duel.SetTargetCard(g)",
        "Duel.SetOperationInfo(0,CATEGORY_CONTROL,g,2,tp,0)",
        "local g=Duel.GetTargetCards(e)",
        "Duel.SwapControl(g:GetFirst(),g:GetNext())",
        "destroyDuelCard(restoredOpen.session.state, restoredOwnLinked.uid",
        'eventName": "controlChanged"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-chthonian-polymer-fusion-release-control.test.ts",
      kind: "fusionSummonReleaseCostControl",
      required: [
        'const chthonianPolymerCode = "72287557"',
        "--Chthonian Polymer",
        "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
        "tc:IsFusionSummoned()",
        "Duel.GetMZoneCount(tp,c)>0",
        "Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,nil,nil,tp,eg)",
        "Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,nil,nil,tp,eg)",
        "Duel.SetTargetCard(eg)",
        "Duel.GetControl(tc,tp)",
        'eventName: "released"',
        'eventName: "controlChanged"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-missing-force-release-control-lock.test.ts",
      kind: "releaseCostActivityLockedControl",
      required: [
        'const missingForceCode = "12836042"',
        "--Missing Force",
        "restores self release cost into Special Summon and Battle Phase locks plus temporary control",
        "Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)<=1",
        "Duel.GetActivityCount(tp,ACTIVITY_BATTLE_PHASE)==0",
        "Duel.GetActivityCount(tp,ACTIVITY_SPSUMMON)==0",
        "e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)",
        "e2:SetCode(EFFECT_CANNOT_BP)",
        "aux.RegisterClientHint(e:GetHandler(),nil,tp,1,0,aux.Stringid(id,1),nil)",
        "Duel.Release(e:GetHandler(),REASON_COST)",
        "Duel.SelectTarget(tp,Card.IsControlerCanBeChanged,tp,0,LOCATION_MZONE,1,1,nil)",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
        'eventName: "released"',
        'eventName: "becameTarget"',
        'eventName: "controlChanged"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-evil-hero-neos-lord-summon-grave-control-protect.test.ts",
      kind: "summonAndGraveTriggerControlProtect",
      required: [
        'const neosLordCode = "13708888"',
        "--Evil HERO Neos Lord",
        "Fusion.AddProcMix(c,true,true,{CARD_NEOS,s.neosfusionmatfilter},s.effectmatfilter)",
        "c:AddMustBeSpecialSummonedByDarkFusion()",
        "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
        "e2:SetCode(EVENT_TO_GRAVE)",
        "EFFECT_FLAG2_CHECK_SIMULTANEOUS",
        "return eg:IsExists(s.ctrlconfilter,1,nil,tp)",
        "Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsControlerCanBeChanged),tp,0,LOCATION_MZONE,1,1,nil)",
        "Duel.GetControl(tc,tp)",
        "e3:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
        "e4:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)",
        'eventName: "specialSummoned"',
        'eventName: "sentToGraveyard"',
        'eventName: "controlChanged"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-splash-capture-xyz-banish-control.test.ts",
      kind: "xyzSummonBanishCostControl",
      required: [
        'const splashCaptureCode = "39765115"',
        "--Splash Capture",
        "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
        "tc:IsXyzSummoned()",
        "aux.SpElimFilter(c,true)",
        "Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,2,2,nil)",
        "Duel.Remove(g,POS_FACEUP,REASON_COST)",
        "Duel.SetTargetCard(eg)",
        "Duel.GetControl(tc,tp)",
        'eventName: "banished"',
        'eventName: "controlChanged"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-alien-hypno-gemini-counter-control.test.ts",
      kind: "geminiCounterControlEndDestroy",
      required: [
        'const alienHypnoCode = "38468214"',
        "--Alien Hypno",
        "Gemini.AddProcedure(c)",
        "e1:SetCondition(Gemini.EffectStatusCondition)",
        "return c:GetCounter(COUNTER_A)>0 and c:IsControlerCanBeChanged()",
        "e1:SetCode(EFFECT_SET_CONTROL)",
        "tc:RegisterEffect(e1)",
        "e2:SetCode(EVENT_PHASE+PHASE_END)",
        "c:RemoveCounter(tp,COUNTER_A,1,REASON_EFFECT)",
        "Duel.RaiseEvent(c,EVENT_REMOVE_COUNTER+COUNTER_A,e,REASON_EFFECT,tp,tp,1)",
        "e3:SetCode(EFFECT_SELF_DESTROY)",
        'eventName: "controlChanged"',
        'eventName: "counterRemoved"',
        'eventName: "destroyed"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-maiden-in-love-battle-counter-control.test.ts",
      kind: "battleCounterControl",
      required: [
        "restores Damage Step End SelectEffect branches into counter placement and control take",
        "--Maiden in Love",
        "e1:SetCode(EFFECT_MUST_ATTACK)",
        "e2:SetCode(EFFECT_MUST_ATTACK_MONSTER)",
        "e3:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
        "e4:SetCode(EVENT_DAMAGE_STEP_END)",
        "return c:GetBattleTarget() and c:IsStatus(STATUS_OPPO_BATTLE)",
        "Duel.SelectEffect(tp,",
        "Duel.IsExistingMatchingCard(Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,nil,COUNTER_MAIDEN,1)",
        "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,tp,COUNTER_MAIDEN)",
        "Duel.GetMatchingGroup(s.controlfilter,tp,0,LOCATION_MZONE,nil)",
        "Duel.SetOperationInfo(0,CATEGORY_CONTROL,g,1,tp,0)",
        "Duel.SelectMatchingCard(tp,Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,1,nil,COUNTER_MAIDEN,1)",
        "sc:AddCounter(COUNTER_MAIDEN,1)",
        "Duel.SelectMatchingCard(tp,s.controlfilter,tp,0,LOCATION_MZONE,1,1,nil)",
        "Duel.GetControl(sc,tp)",
        'eventName: "counterAdded"',
        'eventName: "controlChanged"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-utopic-future-damage-step-control-replace.test.ts",
      kind: "damageStepBattleControlReplace",
      required: [
        "restores battle damage prevention, Damage Step End control, and detach destroy replacement",
        'const utopicFutureCode = "65305468"',
        "--Number F0: Utopic Future",
        "Xyz.AddProcedure(c,s.xyzfilter,nil,2,nil,nil,nil,nil,false,s.xyzcheck)",
        "EFFECT_EQUIP_SPELL_XYZ_MAT",
        "Card.GetRank",
        "e3:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
        "e4:SetCode(EFFECT_NO_BATTLE_DAMAGE)",
        "e5:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)",
        "e6:SetCode(EVENT_DAMAGE_STEP_END)",
        "Duel.GetControl(tc,tp,PHASE_BATTLE,1)",
        "e7:SetCode(EFFECT_DESTROY_REPLACE)",
        "Duel.SelectEffectYesNo(tp,c,96)",
        "c:RemoveOverlayCard(tp,1,1,REASON_EFFECT)",
        'eventName: "damageStepEnded"',
        'eventName: "controlChanged"',
        'eventName: "detachedMaterial"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-utopic-future-zexal-chain-control-protect-stat.test.ts",
      kind: "chainDetachControlProtectStat",
      required: [
        'const zexalCode = "41522092"',
        "--Number F0: Utopic Future Zexal",
        "restores Rank-sum stats, field targeting protections, and EVENT_CHAINING detach control",
        "Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsType,TYPE_XYZ),e:GetHandlerPlayer(),LOCATION_MZONE,LOCATION_GRAVE,nil):GetSum(Card.GetRank)*500",
        "e3:SetCode(EFFECT_CANNOT_SELECT_BATTLE_TARGET)",
        "e4:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)",
        "e4:SetValue(aux.tgoval)",
        "e5:SetCode(EVENT_CHAINING)",
        "Duel.GetChainInfo(0,CHAININFO_TRIGGERING_LOCATION,CHAININFO_TRIGGERING_PLAYER)",
        "e5:SetCost(Cost.DetachFromSelf(1))",
        "Duel.SelectMatchingCard(tp,Card.IsControlerCanBeChanged,tp,0,LOCATION_MZONE,1,1,nil)",
        "Duel.GetControl(g,tp)",
        "e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
        "e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)",
        "currentAttack(restoredZexal, restoredOpen.session.state)).toBe(4500)",
        "currentDefense(restoredZexal, restoredOpen.session.state)).toBe(4500)",
        'eventName: "detachedMaterial"',
        'eventName: "controlChanged"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-predaplant-pterapenthes-battle-counter-control.test.ts",
      kind: "battleCounterControl",
      required: [
        "restores battle-damage target counter into level change and temporary control",
        "--Predaplant Pterapenthes",
        "e1:SetCode(EVENT_BATTLE_DAMAGE)",
        "return ep~=tp",
        "Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,1,nil,COUNTER_PREDATOR,1)",
        "local tc=Duel.GetFirstTarget()",
        "tc:AddCounter(COUNTER_PREDATOR,1)",
        "e1:SetCode(EFFECT_CHANGE_LEVEL)",
        "return e:GetHandler():GetCounter(COUNTER_PREDATOR)>0",
        "return c:IsFaceup() and c:IsLevelBelow(mc:GetLevel()) and c:IsControlerCanBeChanged()",
        "Duel.SelectTarget(tp,s.ctfilter2,tp,0,LOCATION_MZONE,1,1,nil,c)",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
        'eventName: "battleDamageDealt"',
        'eventName: "counterAdded"',
        'eventName: "controlChanged"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-mementotlan-mace-control-search.test.ts",
      kind: "selfDiscardTemporaryControl",
      required: [
        "restores opponent-turn SelfDiscard control and Memento destroy-to-search ignition",
        "return Duel.IsMainPhase() and Duel.IsTurnPlayer(1-tp)",
        "e1:SetCost(Cost.SelfDiscard)",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
        "e2:SetCategory(CATEGORY_DESTROY+CATEGORY_TOHAND+CATEGORY_SEARCH)",
        'eventName: "sentToGraveyard"',
        'eventName: "controlChanged"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-mimighoul-dragon-flip-summon-search.test.ts",
      kind: "flipDestroyControlSearch",
      required: [
        "restores face-down opponent summon, Main Phase FLIP destroy-control, and summon search",
        "e1:SetCategory(CATEGORY_DESTROY+CATEGORY_CONTROL)",
        "e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP+EFFECT_TYPE_TRIGGER_F)",
        "Duel.GetControl(c,1-tp)",
        "e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_POSITION)",
        'eventName: "controlChanged"',
        'eventName: "sentToHandConfirmed"',
        "previousController: 0",
      ],
    },
    {
      file: "lua-real-script-mushroom-man-2-standby-end-control.test.ts",
      kind: "phaseEndSelfControl",
      required: [
        "restores turn-player Standby damage and LP-cost End Phase control transfer",
        "--Mushroom Man #2",
        "e2:SetCategory(CATEGORY_CONTROL)",
        "e2:SetCode(EVENT_PHASE+PHASE_END)",
        "e2:SetCost(Cost.PayLP(500))",
        "Duel.SetOperationInfo(0,CATEGORY_CONTROL,e:GetHandler(),1,0,0)",
        "Duel.GetControl(c,1-tp)",
        'eventName: "phaseEnd"',
        'eventName: "lifePointCostPaid"',
        'eventName: "controlChanged"',
        "previousController: 0",
      ],
    },
    {
      file: "lua-real-script-putrid-pudding-body-buddies-pzone-control-damage.test.ts",
      kind: "pzoneDestroyControlDamage",
      required: [
        "restores release/material locks plus End Phase PZone destroy-control and Standby damage",
        "--Putrid Pudding Body Buddies",
        "e1:SetCode(EFFECT_UNRELEASABLE_SUM)",
        "e2:SetCode(EFFECT_UNRELEASABLE_NONSUM)",
        "e3:SetCode(EFFECT_CANNOT_BE_FUSION_MATERIAL)",
        "e4:SetCode(EFFECT_CANNOT_BE_SYNCHRO_MATERIAL)",
        "e5:SetCode(EFFECT_CANNOT_BE_XYZ_MATERIAL)",
        "e6:SetCategory(CATEGORY_DESTROY+CATEGORY_CONTROL)",
        "e6:SetCode(EVENT_PHASE+PHASE_END)",
        "Duel.SelectTarget(tp,nil,tp,LOCATION_PZONE,0,1,1,nil)",
        "Duel.Destroy(tc,REASON_EFFECT)",
        "Duel.GetControl(c,1-tp)",
        "e7:SetCategory(CATEGORY_DAMAGE)",
        "e7:SetCode(EVENT_PHASE|PHASE_STANDBY)",
        "Duel.Damage(tp,300,REASON_EFFECT)",
        'eventName: "phaseEnd"',
        'eventName: "becameTarget"',
        'eventName: "destroyed"',
        'eventName: "controlChanged"',
        'eventName: "damageDealt"',
        "previousController: 0",
      ],
    },
    {
      file: "lua-real-script-rb-lambda-blade-send-control-delayed-destroy.test.ts",
      kind: "linkedLpCostControlDelayedDestroy",
      required: [
        "restores summon send-to-GY trigger and LP-cost linked control with delayed End Phase destroy",
        "e1a:SetCategory(CATEGORY_TOGRAVE)",
        "Duel.SendtoGrave(g,REASON_EFFECT)",
        "e2:SetCost(Cost.PayLP(1400))",
        "Duel.GetMZoneCount(tp,c,tp,LOCATION_REASON_CONTROL)>0",
        "Duel.Destroy(c,REASON_EFFECT)>0",
        "Duel.GetControl(tc,tp)",
        "aux.DelayedOperation(tc,PHASE_END,id,e,tp,function(ag) Duel.Destroy(ag,REASON_EFFECT) end,nil,0,0,aux.Stringid(id,2))",
        'eventName: "lifePointCostPaid"',
        'eventName: "controlChanged"',
        "effect.code === 0x1200",
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-reptilianne-recoil-destroy-summon-chain-token.test.ts",
      kind: "chainControlToken",
      required: [
        "restores field destroy-summon and opponent monster-chain control plus token summon",
        "e3:SetCode(EVENT_CHAINING)",
        "return rp==1-tp and re:IsMonsterEffect()",
        "Duel.GetControl(tc,tp)",
        "Duel.BreakEffect()",
        "Duel.SpecialSummon(token,0,tp,1-tp,false,false,POS_FACEUP)",
        'eventName: "controlChanged"',
        'eventName: "specialSummoned"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-ancient-warriors-deception-summon-attribute-control.test.ts",
      kind: "selfToGraveAttributeControl",
      required: [
        "restores SZone Ancient Warriors summon-burn and self-to-Grave attribute-control branch",
        "--Ancient Warriors Saga - Deception and Betrayal",
        "e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_DAMAGE)",
        "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)",
        "Duel.Damage(tp,tc:GetLevel()*100,REASON_EFFECT)",
        "e3:SetCost(Cost.SelfToGrave)",
        "Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSetCard,SET_ANCIENT_WARRIORS),tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
        "local att=tc:AnnounceAnotherAttribute(tp)",
        "e1:SetCode(EFFECT_CHANGE_ATTRIBUTE)",
        "Duel.SelectYesNo(tp,aux.Stringid(id,2))",
        "Duel.GetControl(tc,tp)",
        'api: "SelectYesNo"',
        'eventName: "specialSummoned"',
        'eventName: "damageDealt"',
        'eventName: "sentToGraveyard"',
        'eventName: "controlChanged"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-ashened-eternity-owned-control-atk-drain.test.ts",
      kind: "ownedControlAttackDrain",
      required: [
        'const ashenedCode = "66848311"',
        "restores owned-opponent monster control and optional opponent ATK drain after the control change",
        "Duel.SelectTarget(tp,s.ctrlfilter,tp,0,LOCATION_MZONE,1,1,nil,tp)",
        "Duel.GetControl(tc,tp)",
        "Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)",
        "e1:SetCode(EFFECT_UPDATE_ATTACK)",
        "api: \"SelectYesNo\"",
        "previousController: 1",
        "eventName: \"controlChanged\"",
      ],
    },
    {
      file: "lua-real-script-tellusion-magna-warrior-chain-control-summon.test.ts",
      kind: "chainControlSummon",
      required: [
        "restores procedure metadata, opponent-chain EARTH control, and opponent-turn SelfTribute banished Sigma summon",
        "e1:SetCode(EVENT_CHAINING)",
        "Duel.SetPossibleOperationInfo(0,CATEGORY_CONTROL,tc,1,tp,0)",
        "Duel.GetControl(tc,tp)",
        "e2:SetCost(Cost.SelfTribute)",
        "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
        'eventName: "controlChanged"',
        'eventName: "specialSummoned"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-ally-enemy-catcher-summon-control-return.test.ts",
      kind: "summonTriggerTemporaryControl",
      required: [
        'const enemyCatcherCode = "45033006"',
        "restores summon-triggered face-down Defense control and the End Phase return",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
        'luaValueDescriptor: "temporary-control-return"',
        "position: \"faceDownDefense\"",
        "faceUp: false",
      ],
    },
    {
      file: "lua-real-script-archfiends-advent-sarcophagus-summon-control-stat.test.ts",
      kind: "summonProcControlAttackLockStat",
      required: [
        'const adventCode = "53008933"',
        "--Archfiend's Advent",
        "restores Shining Sarcophagus no-tribute summon into control and turn-player ally ATK gain",
        "restores the no-Sarcophagus control branch that prevents the taken monster from attacking",
        "e1:SetCode(EFFECT_SUMMON_PROC)",
        "CARD_SHINING_SARCOPHAGUS",
        "e2:SetCode(EVENT_SUMMON_SUCCESS)",
        "e3:SetCode(EVENT_SPSUMMON_SUCCESS)",
        "Duel.SelectTarget(tp,Card.IsControlerCanBeChanged,tp,0,LOCATION_MZONE,1,1,nil)",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
        "e1:SetCode(EFFECT_CANNOT_ATTACK)",
        "e4:SetCode(EFFECT_UPDATE_ATTACK)",
        "e4:SetValue(500)",
        "currentAttack(requireCard(restoredSummon.session, allyCode), restoredSummon.session.state)).toBe(1800)",
        'eventName: "normalSummoned"',
        'eventName: "specialSummoned"',
        'eventName: "controlChanged"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-change-of-heart-control-return.test.ts",
      kind: "temporaryControl",
      required: [
        'luaValueDescriptor: "temporary-control-return"',
        'registryKey: `lua:${targetCode}:temporary-control-return:${target!.uid}`',
        "not.toContain(`lua:${targetCode}:temporary-control-return:${target!.uid}`)",
      ],
    },
    {
      file: "lua-real-script-brain-control-cost-return.test.ts",
      kind: "restrictedTemporaryControl",
      required: [
        "lifePointCostPaid",
        "players[0].lifePoints).toBe(7200)",
        'luaValueDescriptor: "temporary-control-return"',
      ],
    },
    {
      file: "lua-real-script-electric-virus-discard-control.test.ts",
      kind: "discardCostTemporaryControl",
      required: [
        'const electricVirusCode = "24725825"',
        "restores Electric Virus's discard cost, race-gated target, temporary GetControl, and End Phase return",
        "duelReason.cost | duelReason.discard",
        'luaValueDescriptor: "temporary-control-return"',
        "eventName: \"controlChanged\"",
      ],
    },
    {
      file: "lua-real-script-mind-pollutant-discard-level-control.test.ts",
      kind: "discardCostTemporaryControl",
      required: [
        'const mindPollutantCode = "69257165"',
        "Duel.SendtoGrave(sg,REASON_COST|REASON_DISCARD)",
        "local lv=sg:GetFirst():GetLevel()",
        "tc:GetLevel()==e:GetLabel()",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
        'eventName: "controlChanged"',
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-dharc-flip-set-control.test.ts",
      kind: "flipSetControl",
      required: [
        'const dharcCode = "19327348"',
        "restores Dharc's targeted flip control effect and persistent EFFECT_SET_CONTROL handoff",
        'action.type === "activateTrigger" && action.uid === dharc.uid',
        "eventName: \"controlChanged\"",
        "dharcCardTargets(restoredChain.session, dharc.uid)).toContain(darkTarget.uid)",
      ],
    },
    {
      file: "lua-real-script-rafflesia-flip-get-control.test.ts",
      kind: "flipGetControl",
      required: [
        'const rafflesiaCode = "31440542"',
        "restores Rafflesia Seduction's flip target, temporary GetControl, and End Phase return",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
        'luaValueDescriptor: "temporary-control-return"',
        "eventName: \"controlChanged\"",
      ],
    },
    {
      file: "lua-real-script-electromagnetic-bagworm-opponent-turn-control.test.ts",
      kind: "flipGetControl",
      required: [
        'const bagwormCode = "7914843"',
        "restores Bagworm's opponent-turn flip GetControl duration branch",
        "if Duel.IsTurnPlayer(1-tp) then tct=2",
        "Duel.GetControl(tc,tp,PHASE_END,tct)",
        "reset: { count: 2, flags: 0x40801200 }",
        'eventName: "controlChanged"',
      ],
    },
    {
      file: "lua-real-script-enemy-controller-control-cost.test.ts",
      kind: "releaseCostControl",
      required: [
        "effectLabel: 2",
        "duelReason.release",
        "duelReason.cost",
        'luaValueDescriptor: "temporary-control-return"',
      ],
    },
    {
      file: "lua-real-script-darklord-enchantment-cost-control.test.ts",
      kind: "releaseCostControl",
      required: [
        'const darklordEnchantmentCode = "87990236"',
        "Duel.GetMZoneCount(tp,c,tp,LOCATION_REASON_CONTROL)>0",
        "Duel.SendtoGrave(g,REASON_COST)",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
        'eventName: "controlChanged"',
      ],
    },
    {
      file: "lua-real-script-double-magical-arm-bind-release-control.test.ts",
      kind: "releaseCostControl",
      required: [
        'const armBindCode = "72621670"',
        "Duel.SelectReleaseGroupCost(tp,nil,2,2,false,s.chk,nil,dg)",
        "Duel.Release(g,REASON_COST)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS):Filter(s.tfilter,nil,e)",
        "Duel.GetControl(g,tp,PHASE_END,rct)",
        'eventName: "controlChanged"',
      ],
    },
    {
      file: "lua-real-script-mind-control-restrictions.test.ts",
      kind: "restrictedTemporaryControl",
      required: [
        "restrictionCodes(restoredResponseWindow.session, target!.uid)).toEqual([43, 44, 85])",
        "mind release probe true/false/0",
        'action.type === "declareAttack"',
      ],
    },
    {
      file: "lua-real-script-creature-swap-control-lock.test.ts",
      kind: "swapControlLock",
      required: [
        "targetUids ?? []).toEqual([])",
        "positionLockCodes(restoredResponseWindow.session, ownMonster!.uid)).toEqual([14])",
        "creature swap position probe false/false",
      ],
    },
    {
      file: "lua-real-script-xyz-reversal-swap-control.test.ts",
      kind: "targetedSwapControl",
      required: [
        "Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)",
        "Duel.SwapControl(a,b)",
        "targetUids: [opponentXyz.uid, ownXyz.uid]",
        "eventUids: [opponentXyz.uid, ownXyz.uid]",
      ],
    },
    {
      file: "lua-real-script-comic-relief-swap-control-destroy.test.ts",
      kind: "targetedSwapControl",
      required: [
        "restores Pendulum-zone SwapControl into self-destroy and control-changed script destruction prompt",
        "Duel.SwapControl(a,b)",
        "Duel.Destroy(e:GetHandler(),REASON_EFFECT)",
        "Duel.GetControl(c,1-tp)",
        "previousController: 0",
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-mystic-box-destroy-control-operation-info.test.ts",
      kind: "targetedSwapControl",
      required: [
        "restores separate destroy/control targets through GetOperationInfo into BreakEffect control transfer",
        "Duel.SetOperationInfo(0,CATEGORY_DESTROY,g1,1,0,0)",
        "Duel.SetOperationInfo(0,CATEGORY_CONTROL,g2,1,0,0)",
        "Duel.Destroy(dc,REASON_EFFECT)>0",
        "Duel.GetControl(cc,1-tp)",
        "previousController: 0",
      ],
    },
    {
      file: "lua-real-script-yummy-redemption-grave-swap-control.test.ts",
      kind: "targetedSwapControl",
      required: [
        "restores grave SelfBanish SelectUnselectGroup targets into SwapControl and field ATK reduction",
        "aux.SelectUnselectGroup(g1,e,tp,2,2,aux.dpcheck(Card.GetControler),1,tp,HINTMSG_CONTROL)",
        "Duel.SwapControl(tg:GetFirst(),tg:GetNext())",
        'eventName: "banished"',
        'eventName: "controlChanged"',
        "previousController: 0",
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-switcheroroo-group-swap.test.ts",
      kind: "groupSwapControl",
      required: [
        "Duel.SwapControl(g1,g2)",
        "restores same-size field groups into grouped SwapControl events",
        "eventUids: [ownFirst!.uid, opponentFirst!.uid, ownSecond!.uid, opponentSecond!.uid]",
        "eventReasonCardUid: switcheroroo!.uid",
      ],
    },
    {
      file: "lua-real-script-full-armor-master-counter-control-end-destroy.test.ts",
      kind: "phaseEndSelfControl",
      required: [
        "restores immunity, chain watchers, Wedge Counter control, and turn-player End Phase destruction",
        "Duel.GetControl(tc,tp)",
        "e5:SetCode(EVENT_PHASE+PHASE_END)",
        "Duel.Destroy(g,REASON_EFFECT)",
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-lu-feng-quick-destroy-end-control.test.ts",
      kind: "phaseEndSelfControl",
      required: [
        "restores custom chain activity cost into highest-ATK destroy and End Phase opponent control",
        "Duel.Destroy(dg,REASON_EFFECT)",
        "e4:SetCode(EVENT_PHASE+PHASE_END)",
        "Duel.GetControl(c,1-tp)",
        "previousController: 0",
      ],
    },
    {
      file: "lua-real-script-mass-hypnosis-counter-control-end-destroy.test.ts",
      kind: "phaseEndSelfControl",
      required: [
        "restores A-counter targeting into persistent control and End Phase self-destroy",
        "Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,ft,nil)",
        "c:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1)",
        "Duel.Destroy(e:GetHandler(),REASON_EFFECT)",
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-penguin-torpedo-direct-control-destroy.test.ts",
      kind: "phaseEndSelfControl",
      required: [
        "restores direct battle-damage control into temporary negation, cannot attack, and self-destroy",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
        "Duel.Destroy(c,REASON_EFFECT)",
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-mataza-control-extra-attack.test.ts",
      kind: "cannotChangeControl",
      required: [
        "code: 5",
        "mataza control predicate false",
        "mataza control take 0",
        "mataza control swap false",
      ],
    },
    {
      file: "lua-real-script-snatch-steal-equip-control.test.ts",
      kind: "equipControl",
      required: [
        "equippedToUid: target!.uid",
        "previousEquippedToUid: target!.uid",
        "snatch probe 0/45986603/612501",
        "snatch probe 1/nil/nil",
      ],
    },
    {
      file: "lua-real-script-suppression-pluto-announce-control.test.ts",
      kind: "selectedPermanentControl",
      required: [
        'const plutoCode = "24413299"',
        "restores announced opponent hand confirmation into the selected GetControl branch",
        "Duel.SelectEffect(tp,{#g1>0,aux.Stringid(id,1)},{#g2>0,aux.Stringid(id,2)})",
        "Duel.GetControl(tc,tp)",
        'api: "AnnounceCard"',
        'api: "SelectEffect"',
        'eventName: "controlChanged"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ControlKind;
    required: string[];
  }>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

function countControlKinds(fixtures: Array<{ kind: ControlKind }>): Record<ControlKind, number> {
  return fixtures.reduce<Record<ControlKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      battleStartPhaseControl: 0,
      battleDestroyedTrapControlRace: 0,
      damageStepBattleControlReplace: 0,
      chainDetachControlProtectStat: 0,
      battleCounterControl: 0,
      chainControlSummon: 0,
      chainControlToken: 0,
      cannotChangeControl: 0,
      confirmDamageGroupControl: 0,
      detachGroupControlStatCode: 0,
      detachControlStatCode: 0,
      detachControlReleaseDestroy: 0,
      discardCostTemporaryControl: 0,
      equipControl: 0,
      flipDestroyControlSearch: 0,
      flipGetControl: 0,
      flipSetControl: 0,
      fusionSummonReleaseCostControl: 0,
      geminiCounterControlEndDestroy: 0,
      groupSwapControl: 0,
      linkedZoneControlRevive: 0,
      linkedGroupSwapProtect: 0,
      ownedControlAttackDrain: 0,
      phaseEndSelfControl: 0,
      pzoneDestroyControlDamage: 0,
      releaseCostControl: 0,
      releaseCostActivityLockedControl: 0,
      restrictedTemporaryControl: 0,
      searchDestroyGraveControl: 0,
      selectedPermanentControl: 0,
      selfDiscardTemporaryControl: 0,
      selfToGraveAttributeControl: 0,
      summonTriggerTemporaryControl: 0,
      summonAndGraveTriggerControlProtect: 0,
      summonProcControlAttackLockStat: 0,
      linkedLpCostControlDelayedDestroy: 0,
      swapControlLock: 0,
      targetedSwapControl: 0,
      temporaryControl: 0,
      xyzSummonBanishCostControl: 0,
    },
  );
}

function realScriptControlSemanticVariants(): Array<{
  file: string;
  kind: ControlSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-ashened-eternity-owned-control-atk-drain.test.ts",
      kind: "ashenedEternityOwnedControlAttackDrain",
      required: [
        'const ashenedCode = "66848311"',
        "Duel.GetControl(tc,tp)",
        "Duel.SelectYesNo(tp,aux.Stringid(id,2))",
        "expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === opponentFaceup.uid)!, restoredOpen.session.state)).toBe(400)",
        "value: -1800",
      ],
    },
    {
      file: "lua-real-script-brain-control-cost-return.test.ts",
      kind: "brainControlLpCostReturn",
      required: [
        'const brainControlCode = "87910978"',
        "restores Brain Control's LP cost, summonable target filter, and End Phase return",
        "lifePointCostPaid",
        "players[0].lifePoints).toBe(7200)",
        "extraTarget!.uid)).toMatchObject({ controller: 1, location: \"monsterZone\" })",
      ],
    },
    {
      file: "lua-real-script-ally-enemy-catcher-summon-control-return.test.ts",
      kind: "allyEnemyCatcherSummonControlReturn",
      required: [
        "return c:IsFacedown() and c:IsDefensePos() and c:IsControlerCanBeChanged()",
        'action.type === "activateTrigger" && action.uid === enemyCatcher.uid',
        "eventName: \"controlChanged\"",
        'registryKey: `lua:${targetCode}:temporary-control-return:${target.uid}`',
        "not.toContain(`lua:${targetCode}:temporary-control-return:${target.uid}`)",
      ],
    },
    {
      file: "lua-real-script-change-of-heart-control-return.test.ts",
      kind: "changeHeartTemporaryReturn",
      required: [
        'const changeOfHeartCode = "4031928"',
        "restores Change of Heart's target, control operation, and End Phase return",
        "eventName: \"controlChanged\"",
        'luaValueDescriptor: "temporary-control-return"',
        "not.toContain(`lua:${targetCode}:temporary-control-return:${target!.uid}`)",
      ],
    },
    {
      file: "lua-real-script-creature-swap-control-lock.test.ts",
      kind: "creatureSwapControlLock",
      required: [
        'const creatureSwapCode = "31036355"',
        "restores Creature Swap's non-targeting control exchange and position locks",
        "targetUids ?? []).toEqual([])",
        "eventUids: [ownMonster!.uid, opponentMonster!.uid]",
        "creature swap position probe false/false",
      ],
    },
    {
      file: "lua-real-script-dharc-flip-set-control.test.ts",
      kind: "dharcFlipSetControl",
      required: [
        'const dharcCode = "19327348"',
        "restores Dharc's targeted flip control effect and persistent EFFECT_SET_CONTROL handoff",
        "EFFECT_SET_CONTROL",
        "eventName: \"controlChanged\"",
        "duelReason.effect",
      ],
    },
    {
      file: "lua-real-script-rafflesia-flip-get-control.test.ts",
      kind: "rafflesiaFlipGetControl",
      required: [
        'const rafflesiaCode = "31440542"',
        "restores Rafflesia Seduction's flip target, temporary GetControl, and End Phase return",
        "Duel.SetOperationInfo(0,CATEGORY_CONTROL,g,#g,0,0)",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-electromagnetic-bagworm-opponent-turn-control.test.ts",
      kind: "electromagneticBagwormOpponentTurnControl",
      required: [
        'const bagwormCode = "7914843"',
        "restores Bagworm's opponent-turn flip GetControl duration branch",
        "return c:IsFaceup() and c:IsRace(RACE_MACHINE) and c:IsControlerCanBeChanged()",
        "if Duel.IsTurnPlayer(1-tp) then tct=2",
        "elseif Duel.IsPhase(PHASE_END) then tct=3 end",
        "reset: { count: 2, flags: 0x40801200 }",
      ],
    },
    {
      file: "lua-real-script-electric-virus-discard-control.test.ts",
      kind: "electricVirusDiscardControl",
      required: [
        'const electricVirusCode = "24725825"',
        "restores Electric Virus's discard cost, race-gated target, temporary GetControl, and End Phase return",
        "Duel.SendtoGrave(e:GetHandler(),REASON_COST|REASON_DISCARD)",
        "c:IsRace(RACE_MACHINE|RACE_DRAGON)",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
      ],
    },
    {
      file: "lua-real-script-enemy-controller-control-cost.test.ts",
      kind: "enemyControllerReleaseControl",
      required: [
        'const enemyControllerCode = "98045062"',
        "restores Enemy Controller's release-cost control branch and End Phase return",
        "effectLabel: 2",
        "eventName: \"released\"",
        "duelReason.release | duelReason.cost",
      ],
    },
    {
      file: "lua-real-script-mataza-control-extra-attack.test.ts",
      kind: "matazaCannotChangeControl",
      required: [
        'const matazaCode = "22609617"',
        "restores official control-change lock and static extra attack",
        "code === 5",
        "mataza control predicate false",
        "mataza control take 0",
        "hasDirectAttack(secondActions, mataza!.uid)).toBe(true)",
      ],
    },
    {
      file: "lua-real-script-mind-control-restrictions.test.ts",
      kind: "mindControlRestrictions",
      required: [
        'const mindControlCode = "37520316"',
        "restores Mind Control's temporary control, unreleasable, and cannot-attack effects",
        "restrictionCodes(restoredResponseWindow.session, target!.uid)).toEqual([43, 44, 85])",
        "mind release probe true/false/0",
        "action.type === \"declareAttack\" && action.attackerUid === target!.uid)).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-snatch-steal-equip-control.test.ts",
      kind: "snatchStealEquipControl",
      required: [
        'const snatchCode = "45986603"',
        "restores Snatch Steal's equip control and returns control when the equip leaves",
        "equippedToUid: target!.uid",
        "previousEquippedToUid: target!.uid",
        "snatch probe 1/nil/nil",
      ],
    },
    {
      file: "lua-real-script-suppression-pluto-announce-control.test.ts",
      kind: "suppressionPlutoAnnounceControl",
      required: [
        'const plutoCode = "24413299"',
        "Duel.ConfirmCards(tp,g)",
        "Duel.GetControl(tc,tp)",
        "previousController: 1",
        "eventName: \"controlChanged\"",
      ],
    },
    {
      file: "lua-real-script-xyz-reversal-swap-control.test.ts",
      kind: "xyzReversalTargetedSwapControl",
      required: [
        'const reversalCode = "66604523"',
        "restores Xyz Reversal's two selected targets and swaps control from chain target cards",
        "Duel.SetOperationInfo(0,CATEGORY_CONTROL,g1,2,0,0)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)",
        "previousController: 0",
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-yummy-redemption-grave-swap-control.test.ts",
      kind: "yummyRedemptionGraveSwapControl",
      required: [
        'const redemptionCode = "65853758"',
        "Cost.SelfBanish",
        "Duel.SetTargetCard(tg)",
        "Duel.GetTargetCards(e)",
        "Duel.SwapControl(tg:GetFirst(),tg:GetNext())",
        'eventName: "controlChanged"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ControlSemanticVariant;
    required: string[];
  }>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

function countControlSemanticVariants(fixtures: Array<{ kind: ControlSemanticVariant }>): Record<ControlSemanticVariant, number> {
  return fixtures.reduce<Record<ControlSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      allyEnemyCatcherSummonControlReturn: 0,
      brainControlLpCostReturn: 0,
      changeHeartTemporaryReturn: 0,
      creatureSwapControlLock: 0,
      dharcFlipSetControl: 0,
      electromagneticBagwormOpponentTurnControl: 0,
      electricVirusDiscardControl: 0,
      enemyControllerReleaseControl: 0,
      ashenedEternityOwnedControlAttackDrain: 0,
      matazaCannotChangeControl: 0,
      mindControlRestrictions: 0,
      rafflesiaFlipGetControl: 0,
      snatchStealEquipControl: 0,
      suppressionPlutoAnnounceControl: 0,
      xyzReversalTargetedSwapControl: 0,
      yummyRedemptionGraveSwapControl: 0,
    },
  );
}

import { ScriptCard, type EffectDefinition } from "../engine/index.js";
import { DARK_MAGICIAN_CARD_IDS } from "./definitions.js";
import { byId, isDarkMagician, isDarkMagicianCard, isDarkMagicianMonster, isDarkMagicianSpellTrap, isFusion, isRitualMonster, isSpellcaster } from "./predicates.js";

export function buildDarkMagicianEffects(): Map<string, EffectDefinition[]> {
  const scripts = new Map<string, ScriptCard>();
  const script = (id: string) => {
    const existing = scripts.get(id);
    if (existing) return existing;
    const card = new ScriptCard(id);
    scripts.set(id, card);
    return card;
  };

  script(DARK_MAGICIAN_CARD_IDS.magiciansRod)
    .effect("rod-search")
    .label("Search a Dark Magician Spell/Trap")
    .when("normalSummoned")
    .range("field")
    .oncePerTurn()
    .priority(90)
    .can((ctx) => ctx.hasInDeck(isDarkMagicianSpellTrap))
    .do((ctx) => {
      ctx.searchDeck(isDarkMagicianSpellTrap, "Magician's Rod search");
    });

  script(DARK_MAGICIAN_CARD_IDS.illusionOfChaos)
    .effect("illusion-search")
    .label("Reveal to search a Dark Magician monster")
    .range("hand")
    .oncePerTurn()
    .priority(100)
    .can((ctx) => ctx.hasInDeck((card) => isDarkMagicianMonster(card) && card.id !== DARK_MAGICIAN_CARD_IDS.illusionOfChaos) && ctx.hand.length >= 2)
    .do((ctx) => {
      ctx.searchDeck((card) => isDarkMagicianMonster(card) && card.id !== DARK_MAGICIAN_CARD_IDS.illusionOfChaos, "Illusion of Chaos search");
      ctx.returnHandCardToDeck("Illusion of Chaos return");
    });

  script(DARK_MAGICIAN_CARD_IDS.preparationOfRites)
    .effect("prep-search")
    .label("Search Illusion of Chaos")
    .range("hand")
    .oncePerTurn()
    .priority(95)
    .can((ctx) => ctx.hasInDeck(isRitualMonster))
    .do((ctx) => {
      ctx.searchDeck(isRitualMonster, "Preparation of Rites search");
    });

  script(DARK_MAGICIAN_CARD_IDS.magiciansSouls)
    .effect("souls-summon")
    .label("Send Dark Magician and Special Summon itself")
    .range("hand")
    .oncePerTurn()
    .priority(88)
    .can((ctx) => ctx.hasInDeck((card) => isSpellcaster(card) && Number(card.level ?? 0) >= 6))
    .do((ctx) => {
      ctx.sendFromDeck((card) => isSpellcaster(card) && Number(card.level ?? 0) >= 6, "Magicians' Souls cost");
      ctx.specialSummonSelf("Magicians' Souls effect");
    });

  script(DARK_MAGICIAN_CARD_IDS.magiciansSouls)
    .effect("souls-draw")
    .label("Send a Spell/Trap to draw")
    .range("field")
    .oncePerTurn()
    .priority(40)
    .can((ctx) => ctx.hasInHand((card) => card.type === "spell" || card.type === "trap"))
    .do((ctx) => {
      ctx.sendFromHand((card) => card.type === "spell" || card.type === "trap", "Magicians' Souls draw cost");
      ctx.draw(1, "Magicians' Souls draw");
    });

  script(DARK_MAGICIAN_CARD_IDS.darkMagicalCircle)
    .effect("circle-excavate")
    .label("Excavate 3 and add a Dark Magician card")
    .range("hand")
    .oncePerTurn()
    .priority(86)
    .can((ctx) => ctx.excavate(3).some((card) => isDarkMagicianCard(card)))
    .do((ctx) => {
      ctx.addExcavated(isDarkMagicianCard, "Dark Magical Circle add");
    });

  script(DARK_MAGICIAN_CARD_IDS.magicianSalvation)
    .effect("salvation-set")
    .label("Set Eternal Soul from deck")
    .range("hand")
    .oncePerTurn()
    .priority(82)
    .can((ctx) => ctx.hasInDeck(byId(DARK_MAGICIAN_CARD_IDS.eternalSoul)))
    .do((ctx) => {
      ctx.searchDeck(byId(DARK_MAGICIAN_CARD_IDS.eternalSoul), "Magician's Salvation sets Eternal Soul");
    });

  script(DARK_MAGICIAN_CARD_IDS.eternalSoul)
    .effect("eternal-summon")
    .label("Special Summon Dark Magician")
    .range("hand", "field")
    .oncePerTurn()
    .priority(75)
    .can((ctx) => ctx.hasInHand(isDarkMagician) || ctx.graveyard.some((card) => isDarkMagician(card)))
    .do((ctx) => {
      if (ctx.specialSummonFromHand(isDarkMagician, "Eternal Soul summon")) return;
      const card = ctx.graveyard.find(isDarkMagician);
      if (card) {
        ctx.state.zones.graveyard = ctx.state.zones.graveyard.filter((candidate) => candidate.uid !== card.uid);
        ctx.state.zones.field.push(card);
      }
    });

  script(DARK_MAGICIAN_CARD_IDS.timaeusUnitedDragon)
    .effect("timaeus-special")
    .label("Special Summon by sending a Dark Magician card")
    .range("hand")
    .oncePerTurn()
    .priority(70)
    .can((ctx) => ctx.hasInHand((card) => card.uid !== ctx.source.uid && isDarkMagicianCard(card)))
    .do((ctx) => {
      ctx.sendFromHand((card) => card.uid !== ctx.source.uid && isDarkMagicianCard(card), "Timaeus the United Dragon cost");
      ctx.specialSummonSelf("Timaeus the United Dragon effect");
    });

  script(DARK_MAGICIAN_CARD_IDS.secretsOfDarkMagic)
    .effect("secrets-fusion")
    .label("Fusion Summon The Dark Magicians")
    .range("hand")
    .oncePerTurn()
    .priority(80)
    .can((ctx) => ctx.hasInHand(isDarkMagician) && ctx.hasInHand((card) => isSpellcaster(card) && !isDarkMagician(card)) && ctx.extraDeck.some(isFusion))
    .do((ctx) => {
      ctx.fusionSummon(byId(DARK_MAGICIAN_CARD_IDS.theDarkMagicians), [isDarkMagician, (card) => isSpellcaster(card) && !isDarkMagician(card)], "Secrets of Dark Magic fusion");
    });

  script(DARK_MAGICIAN_CARD_IDS.eyeOfTimaeus)
    .effect("eye-fusion")
    .label("Fusion Summon Dark Magician the Dragon Knight")
    .range("hand")
    .oncePerTurn()
    .priority(78)
    .can((ctx) => ctx.hasOnField(isDarkMagician) && ctx.extraDeck.some(byId(DARK_MAGICIAN_CARD_IDS.darkMagicianDragonKnight)))
    .do((ctx) => {
      ctx.fusionSummon(byId(DARK_MAGICIAN_CARD_IDS.darkMagicianDragonKnight), [isDarkMagician], "The Eye of Timaeus fusion");
    });

  script(DARK_MAGICIAN_CARD_IDS.soulServant)
    .effect("soul-servant-stack")
    .label("Stack a Dark Magician card")
    .range("hand")
    .oncePerTurn()
    .priority(65)
    .can((ctx) => ctx.hasInDeck(isDarkMagicianCard))
    .do((ctx) => {
      ctx.searchDeck(isDarkMagicianCard, "Soul Servant V1 adds stacked card to hand");
    });

  const effects = new Map<string, EffectDefinition[]>();
  for (const [id, card] of scripts) effects.set(id, card.effects);
  return effects;
}

import type { CardDefinition } from "#engine/types.js";

export const DARK_MAGICIAN_CARD_IDS = {
  darkMagician: "46986414",
  darkMagicianGirl: "38033121",
  magiciansSouls: "97631303",
  magiciansRod: "7084129",
  illusionOfChaos: "12266229",
  apprenticeIllusionMagician: "30603688",
  timaeusUnitedDragon: "3078380",
  redEyesBlackDragon: "74677422",
  fallenOfAlbaz: "68468459",
  ashBlossom: "14558127",
  soulServant: "23020408",
  darkMagicalCircle: "47222536",
  magicianSalvation: "95477924",
  preparationOfRites: "96729612",
  secretsOfDarkMagic: "59514116",
  eyeOfTimaeus: "1784686",
  magicalizedFusion: "11827244",
  redEyesFusion: "6172122",
  brandedFusion: "44362883",
  calledByTheGrave: "24224830",
  crossoutDesignator: "65681983",
  eternalSoul: "48680970",
  theDarkMagicians: "50237654",
  darkMagicianDragonKnight: "41721210",
  masterOfChaos: "85059922",
  redEyesDarkDragoon: "37818794",
  darkCavalry: "73452089",
  quintetMagician: "84433295",
  mirrorjade: "44146295",
  lubellion: "70534340",
  albion: "87746184",
  granguignol: "24915933",
  ebonIllusionMagician: "96471335",
  redEyesFlareMetal: "44405066",
  dharc: "8264361",
  spLittleKnight: "29301450",
} as const;

const definitions: CardDefinition[] = [
  monster(DARK_MAGICIAN_CARD_IDS.darkMagician, "Dark Magician", ["dark-magician", "normal", "spellcaster"], 7),
  monster(DARK_MAGICIAN_CARD_IDS.darkMagicianGirl, "Dark Magician Girl", ["dark-magician", "spellcaster"], 6),
  monster(DARK_MAGICIAN_CARD_IDS.magiciansSouls, "Magicians' Souls", ["dark-magician", "spellcaster"], 1),
  monster(DARK_MAGICIAN_CARD_IDS.magiciansRod, "Magician's Rod", ["dark-magician", "spellcaster"], 3),
  monster(DARK_MAGICIAN_CARD_IDS.illusionOfChaos, "Illusion of Chaos", ["dark-magician", "ritual", "spellcaster"], 7),
  monster(DARK_MAGICIAN_CARD_IDS.apprenticeIllusionMagician, "Apprentice Illusion Magician", ["dark-magician", "spellcaster"], 6),
  monster(DARK_MAGICIAN_CARD_IDS.timaeusUnitedDragon, "Timaeus the United Dragon", ["dark-magician", "spellcaster"], 8),
  monster(DARK_MAGICIAN_CARD_IDS.redEyesBlackDragon, "Red-Eyes Black Dragon", ["dragon", "normal"], 7),
  monster(DARK_MAGICIAN_CARD_IDS.fallenOfAlbaz, "Fallen of Albaz", ["dragon"], 4),
  monster(DARK_MAGICIAN_CARD_IDS.ashBlossom, "Ash Blossom & Joyous Spring", ["hand-trap", "tuner"], 3),
  spell(DARK_MAGICIAN_CARD_IDS.soulServant, "Soul Servant", ["dark-magician", "search", "draw"]),
  spell(DARK_MAGICIAN_CARD_IDS.darkMagicalCircle, "Dark Magical Circle", ["dark-magician", "search"]),
  spell(DARK_MAGICIAN_CARD_IDS.magicianSalvation, "Magician's Salvation", ["dark-magician", "search"]),
  spell(DARK_MAGICIAN_CARD_IDS.preparationOfRites, "Preparation of Rites", ["ritual", "search"]),
  spell(DARK_MAGICIAN_CARD_IDS.secretsOfDarkMagic, "Secrets of Dark Magic", ["dark-magician", "fusion"]),
  spell(DARK_MAGICIAN_CARD_IDS.eyeOfTimaeus, "The Eye of Timaeus", ["dark-magician", "fusion"]),
  spell(DARK_MAGICIAN_CARD_IDS.magicalizedFusion, "Magicalized Fusion", ["fusion"]),
  spell(DARK_MAGICIAN_CARD_IDS.redEyesFusion, "Red-Eyes Fusion", ["fusion"]),
  spell(DARK_MAGICIAN_CARD_IDS.brandedFusion, "Branded Fusion", ["fusion"]),
  spell(DARK_MAGICIAN_CARD_IDS.calledByTheGrave, "Called by the Grave", ["staple", "disruption"]),
  spell(DARK_MAGICIAN_CARD_IDS.crossoutDesignator, "Crossout Designator", ["staple", "disruption"]),
  trap(DARK_MAGICIAN_CARD_IDS.eternalSoul, "Eternal Soul", ["dark-magician", "summon"]),
  extra(DARK_MAGICIAN_CARD_IDS.theDarkMagicians, "The Dark Magicians", ["dark-magician", "fusion", "spellcaster"]),
  extra(DARK_MAGICIAN_CARD_IDS.darkMagicianDragonKnight, "Dark Magician the Dragon Knight", ["dark-magician", "fusion", "dragon", "spellcaster"]),
  extra(DARK_MAGICIAN_CARD_IDS.masterOfChaos, "Master of Chaos", ["dark-magician", "fusion", "spellcaster"]),
  extra(DARK_MAGICIAN_CARD_IDS.redEyesDarkDragoon, "Red-Eyes Dark Dragoon", ["dark-magician", "fusion", "dragon"]),
  extra(DARK_MAGICIAN_CARD_IDS.darkCavalry, "Dark Cavalry", ["dark-magician", "fusion", "spellcaster"]),
  extra(DARK_MAGICIAN_CARD_IDS.quintetMagician, "Quintet Magician", ["fusion", "spellcaster"]),
  extra(DARK_MAGICIAN_CARD_IDS.mirrorjade, "Mirrorjade the Iceblade Dragon", ["fusion", "dragon"]),
  extra(DARK_MAGICIAN_CARD_IDS.lubellion, "Lubellion the Searing Dragon", ["fusion", "dragon"]),
  extra(DARK_MAGICIAN_CARD_IDS.albion, "Albion the Branded Dragon", ["fusion", "dragon"]),
  extra(DARK_MAGICIAN_CARD_IDS.granguignol, "Granguignol the Dusk Dragon", ["fusion", "spellcaster"]),
  extra(DARK_MAGICIAN_CARD_IDS.ebonIllusionMagician, "Ebon Illusion Magician", ["xyz", "spellcaster"]),
  extra(DARK_MAGICIAN_CARD_IDS.redEyesFlareMetal, "Red-Eyes Flare Metal Dragon", ["xyz", "dragon"]),
  extra(DARK_MAGICIAN_CARD_IDS.dharc, "Dharc the Dark Charmer, Gloomy", ["link", "spellcaster"]),
  extra(DARK_MAGICIAN_CARD_IDS.spLittleKnight, "S:P Little Knight", ["link"]),
];

export const cardRegistry = new Map(definitions.map((card) => [card.id, card]));

function monster(id: string, name: string, tags: string[], level: number): CardDefinition {
  return { id, name, type: "monster", tags, level, ...archetype(tags) };
}

function spell(id: string, name: string, tags: string[]): CardDefinition {
  return { id, name, type: "spell", tags, ...archetype(tags) };
}

function trap(id: string, name: string, tags: string[]): CardDefinition {
  return { id, name, type: "trap", tags, ...archetype(tags) };
}

function extra(id: string, name: string, tags: string[]): CardDefinition {
  return { id, name, type: "extra", tags, ...archetype(tags) };
}

function archetype(tags: string[]): Pick<CardDefinition, "archetype"> | Record<string, never> {
  return tags.includes("dark-magician") ? { archetype: "Dark Magician" } : {};
}

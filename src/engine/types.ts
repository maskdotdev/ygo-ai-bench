export type CardType = "monster" | "spell" | "trap" | "extra";
export type ZoneName = "deck" | "hand" | "field" | "graveyard" | "banished" | "extraDeck";
export type EventName = "manual" | "normalSummoned" | "specialSummoned" | "activated";

export interface CardDefinition {
  id: string;
  name: string;
  type: CardType;
  tags?: string[];
  level?: number;
  archetype?: string;
}

export interface CardInstance {
  uid: string;
  id: string;
  name: string;
  type: CardType;
  tags: string[];
  level?: number;
  archetype?: string;
}

export interface PlaytestLogEntry {
  step: number;
  action: string;
  card?: string;
  detail: string;
}

export interface GameState {
  id: string;
  seed: string;
  zones: Record<ZoneName, CardInstance[]>;
  normalSummonUsed: boolean;
  activatedKeys: Set<string>;
  log: PlaytestLogEntry[];
}

export interface PublicGameState {
  sessionId: string;
  deckCount: number;
  hand: CardSummary[];
  field: CardSummary[];
  graveyard: CardSummary[];
  banished: CardSummary[];
  extraDeck: CardSummary[];
  normalSummonUsed: boolean;
  log: PlaytestLogEntry[];
}

export interface CardSummary {
  uid: string;
  id: string;
  name: string;
  type: CardType;
  tags: string[];
}

export type PlaytestAction =
  | { type: "normalSummon"; uid: string; label: string }
  | { type: "activateEffect"; uid: string; effectId: string; label: string }
  | { type: "setSpellTrap"; uid: string; label: string }
  | { type: "end"; label: string };

export interface PlaytestLegalActionGroup {
  key: string;
  label: string;
  actions: PlaytestAction[];
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
  state: PublicGameState;
  legalActions: PlaytestAction[];
  legalActionGroups: PlaytestLegalActionGroup[];
}

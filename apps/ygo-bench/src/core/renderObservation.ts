import type { Observation } from "./types.js";

export function renderObservationJson(observation: Observation): string {
  return JSON.stringify(
    {
      turn: observation.turn,
      phase: observation.phase,
      prompt: observation.prompt,
      you: {
        lp: observation.publicState.players[observation.player].lp,
        hand: observation.privateState.hand.map((card) => ({ id: card.id, name: card.name })),
        field: {
          monsters: observation.publicState.players[observation.player].monsters,
          spellsTraps: observation.publicState.players[observation.player].spellsTraps,
        },
        graveyard: observation.publicState.players[observation.player].graveyard,
      },
      opponent: summarizeOpponent(observation),
      legalActions: observation.legalActions,
      recentEvents: observation.transcript.slice(-8).map((event) => event.text),
    },
    null,
    2,
  );
}

export function renderObservationText(observation: Observation): string {
  const you = observation.publicState.players[observation.player];
  const opponent = observation.publicState.players[observation.player === 0 ? 1 : 0];
  const hand = observation.privateState.hand.map((card) => `- ${card.id}: ${card.name}`).join("\n");
  const opponentMonsters = opponent.monsters.map((card) => `- ${card.id}: ${card.name}`).join("\n");
  const actions = observation.legalActions.map((action) => `- ${action.id}: ${action.label}`).join("\n");

  return [
    `Turn ${observation.turn}, ${observation.phase}.`,
    "",
    `Your LP: ${you.lp}.`,
    `Opponent LP: ${opponent.lp}.`,
    "",
    "Your hand:",
    hand || "- empty",
    "",
    "Opponent field:",
    opponentMonsters || "- empty",
    "",
    "Legal actions:",
    actions,
    "",
    'Return JSON only: { "actionId": "..." }',
  ].join("\n");
}

function summarizeOpponent(observation: Observation) {
  const opponentId = observation.player === 0 ? 1 : 0;
  const opponent = observation.publicState.players[opponentId];
  return {
    lp: opponent.lp,
    handCount: opponent.handCount,
    deckCount: opponent.deckCount,
    extraDeckCount: opponent.extraDeckCount,
    field: {
      monsters: opponent.monsters,
      spellsTraps: opponent.spellsTraps,
    },
    graveyard: opponent.graveyard,
    banished: opponent.banished,
  };
}

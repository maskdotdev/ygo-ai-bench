import { describe, expect, it } from "vitest";
import { duelEventNameFromCode, phaseEventCode, phaseStartEventCode } from "#duel/event-codes.js";
import { isDuelEventName } from "#duel/event-names.js";
import type { DuelPhase } from "#duel/types.js";

describe("duel event names", () => {
  it("accepts every event name produced from known numeric event codes", () => {
    const eventCodes = [
      1000, 1001, 1010, 1011, 1012, 1013, 1014, 1015, 1019, 1020, 1021, 1022, 1024, 1025, 1026, 1027, 1028, 1029, 1030, 1040, 1050,
      1100, 1101, 1102, 1103, 1104, 1105, 1106, 1107, 1108, 1109, 1110, 1111, 1112, 1113, 1114, 1115, 1116, 1120, 1121, 1130,
      1131, 1132, 1133, 1134, 1136, 1138, 1139, 1140, 1141, 1142, 1143, 1150, 1151, 1152, 1153, 1200, 1201, 1202, 1203, 1210,
      0x10000, 0x20000, 0x10000000,
    ];
    const phases: DuelPhase[] = ["draw", "standby", "main1", "battle", "main2", "end"];
    const phaseCodes = phases.flatMap((phase) => [phaseEventCode(phase), phaseStartEventCode(phase)]);
    const eventNames = [...eventCodes, ...phaseCodes]
      .map((code) => duelEventNameFromCode(code))
      .filter((name): name is NonNullable<typeof name> => name !== undefined);

    expect(eventNames.every(isDuelEventName)).toBe(true);
    expect(isDuelEventName("unknown")).toBe(false);
  });
});

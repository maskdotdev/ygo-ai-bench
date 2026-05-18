export const forceMonsterZoneSummonLockKindCounts = {
  controlReason: 1,
  extraLocationRange: 1,
  linkedZoneSummonSetLock: 1,
  temporarySelectedZone: 1,
} satisfies Record<ForceMonsterZoneSummonLockKind, number>;

export type ForceMonsterZoneSummonLockKind =
  | "controlReason"
  | "extraLocationRange"
  | "linkedZoneSummonSetLock"
  | "temporarySelectedZone";

export function realScriptForceMonsterZoneSummonLockFixtureSnippets(): Array<{
  file: string;
  kind: ForceMonsterZoneSummonLockKind;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-flash-charge-force-mzone-summon-lock.test.ts",
      kind: "linkedZoneSummonSetLock",
      required: [
        "code: 265",
        'action.type === "normalSummon"',
        'action.type === "setMonster"',
        'action.type === "tributeSummon"',
        'action.type === "tributeSet"',
        'action.type === "linkSummon"',
        "Duel.GetLocationCount(0,LOCATION_MZONE)",
        "Duel.GetMZoneCount(0,g)",
        "flash charge force mzone 8/0",
        "flash charge force mzone link material 0",
        "flash charge force mzone tribute material 0",
      ],
    },
    {
      file: "test/lua-real-script-gorgon-force-mzone-control-reason.test.ts",
      kind: "controlReason",
      required: [
        "code: 265",
        "LOCATION_REASON_CONTROL",
        "gorgon force mzone summon/control 0/1",
        "gorgon force mzone control predicate true",
        "gorgon force mzone control take 1",
        "gorgon force mzone control result 0/3",
      ],
    },
    {
      file: "test/lua-real-script-steelswarm-origin-force-mzone-extra-range.test.ts",
      kind: "extraLocationRange",
      required: [
        "targetRange: [0x40, 0x40]",
        'action.type === "linkSummon"',
        "origin force mzone linked 16",
        "origin force mzone generic material 1",
      ],
    },
    {
      file: "test/lua-real-script-dai-dance-force-mzone-selected-zone.test.ts",
      kind: "temporarySelectedZone",
      required: [
        "SelectDisableField",
        "targetRange: [0, 1]",
        "value: 97",
        "dai dance force mzone count 1",
        "dai dance force mzone check true/false",
        "dai dance force mzone candidate true",
      ],
    },
  ];
}

export function countForceMonsterZoneSummonLockKinds(
  files: Array<{ kind: ForceMonsterZoneSummonLockKind }>,
): Record<ForceMonsterZoneSummonLockKind, number> {
  return files.reduce<Record<ForceMonsterZoneSummonLockKind, number>>(
    (counts, { kind }) => {
      counts[kind] += 1;
      return counts;
    },
    {
      controlReason: 0,
      extraLocationRange: 0,
      linkedZoneSummonSetLock: 0,
      temporarySelectedZone: 0,
    },
  );
}

import fengari from "fengari";
import { duelActivity } from "#duel/activity.js";
import { pushCardTable } from "#lua/card-api.js";
import { pushGroupTable } from "#lua/group-api.js";
import { readGroupUids, readOptionalFunctionRef, releaseOptionalFunctionRef } from "#lua/api-utils.js";

const { lua, lauxlib, to_luastring } = fengari;

export function installConstants(L: unknown): void {
  const constants: Record<string, number> = {
    LOCATION_DECK: 0x01,
    LOCATION_HAND: 0x02,
    LOCATION_MZONE: 0x04,
    LOCATION_SZONE: 0x08,
    LOCATION_ONFIELD: 0x0c,
    LOCATION_GRAVE: 0x10,
    LOCATION_REMOVED: 0x20,
    LOCATION_EXTRA: 0x40,
    ZONES_MMZ: 0x1f,
    ZONES_EMZ: 0x60,
    POS_FACEUP_ATTACK: 0x1,
    POS_FACEDOWN_ATTACK: 0x2,
    POS_FACEUP_DEFENSE: 0x4,
    POS_FACEDOWN_DEFENSE: 0x8,
    TYPE_MONSTER: 0x1,
    TYPE_SPELL: 0x2,
    TYPE_TRAP: 0x4,
    TYPE_NORMAL: 0x10,
    TYPE_EFFECT: 0x20,
    TYPE_FUSION: 0x40,
    TYPE_RITUAL: 0x80,
    TYPE_TUNER: 0x1000,
    TYPE_SYNCHRO: 0x2000,
    TYPE_XYZ: 0x800000,
    TYPE_PENDULUM: 0x1000000,
    TYPE_LINK: 0x4000000,
    RACE_WARRIOR: 0x1,
    RACE_SPELLCASTER: 0x2,
    RACE_DRAGON: 0x2000,
    ATTRIBUTE_EARTH: 0x1,
    ATTRIBUTE_WATER: 0x2,
    ATTRIBUTE_FIRE: 0x4,
    ATTRIBUTE_WIND: 0x8,
    ATTRIBUTE_LIGHT: 0x10,
    ATTRIBUTE_DARK: 0x20,
    ATTRIBUTE_DIVINE: 0x40,
    CATEGORY_DESTROY: 0x1,
    CATEGORY_RELEASE: 0x2,
    CATEGORY_REMOVE: 0x4,
    CATEGORY_TOHAND: 0x8,
    CATEGORY_TODECK: 0x10,
    CATEGORY_TOGRAVE: 0x20,
    CATEGORY_DECKDES: 0x40,
    CATEGORY_HANDES: 0x80,
    CATEGORY_SUMMON: 0x100,
    CATEGORY_SPECIAL_SUMMON: 0x200,
    CATEGORY_TOKEN: 0x400,
    CATEGORY_FLIP: 0x800,
    CATEGORY_POSITION: 0x1000,
    CATEGORY_CONTROL: 0x2000,
    CATEGORY_DISABLE: 0x4000,
    CATEGORY_DISABLE_SUMMON: 0x8000,
    CATEGORY_DRAW: 0x10000,
    CATEGORY_SEARCH: 0x20000,
    CATEGORY_EQUIP: 0x40000,
    CATEGORY_DAMAGE: 0x80000,
    CATEGORY_RECOVER: 0x100000,
    CATEGORY_ATKCHANGE: 0x200000,
    CATEGORY_DEFCHANGE: 0x400000,
    CATEGORY_COUNTER: 0x800000,
    CATEGORY_COIN: 0x1000000,
    CATEGORY_DICE: 0x2000000,
    CATEGORY_LEAVE_GRAVE: 0x4000000,
    CATEGORY_LVCHANGE: 0x8000000,
    CATEGORY_NEGATE: 0x10000000,
    CATEGORY_ANNOUNCE: 0x20000000,
    CATEGORY_FUSION_SUMMON: 0x40000000,
    CATEGORY_TOEXTRA: 0x80000000,
    CATEGORY_SET: 0x100000000,
    EFFECT_FLAG_INITIAL: 0x1,
    EFFECT_FLAG_FUNC_VALUE: 0x2,
    EFFECT_FLAG_COUNT_LIMIT: 0x4,
    EFFECT_FLAG_FIELD_ONLY: 0x8,
    EFFECT_FLAG_CARD_TARGET: 0x10,
    EFFECT_FLAG_IGNORE_RANGE: 0x20,
    EFFECT_FLAG_ABSOLUTE_TARGET: 0x40,
    EFFECT_FLAG_IGNORE_IMMUNE: 0x80,
    EFFECT_FLAG_SET_AVAILABLE: 0x100,
    EFFECT_FLAG_CANNOT_NEGATE: 0x200,
    EFFECT_FLAG_CANNOT_DISABLE: 0x400,
    EFFECT_FLAG_PLAYER_TARGET: 0x800,
    EFFECT_FLAG_BOTH_SIDE: 0x1000,
    EFFECT_FLAG_COPY_INHERIT: 0x2000,
    EFFECT_FLAG_DAMAGE_STEP: 0x4000,
    EFFECT_FLAG_DAMAGE_CAL: 0x8000,
    EFFECT_FLAG_DELAY: 0x10000,
    EFFECT_FLAG_SINGLE_RANGE: 0x20000,
    EFFECT_FLAG_UNCOPYABLE: 0x40000,
    EFFECT_FLAG_OATH: 0x80000,
    EFFECT_FLAG_SPSUM_PARAM: 0x100000,
    EFFECT_FLAG_REPEAT: 0x200000,
    EFFECT_FLAG_NO_TURN_RESET: 0x400000,
    EFFECT_FLAG_EVENT_PLAYER: 0x800000,
    EFFECT_FLAG_OWNER_RELATE: 0x1000000,
    EFFECT_FLAG_CANNOT_INACTIVATE: 0x2000000,
    EFFECT_FLAG_CLIENT_HINT: 0x4000000,
    EFFECT_FLAG_CONTINUOUS_TARGET: 0x8000000,
    EFFECT_FLAG_LIMIT_ZONE: 0x10000000,
    EFFECT_FLAG_IMMEDIATELY_APPLY: 0x80000000,
    TIMING_DRAW_PHASE: 0x1,
    TIMING_STANDBY_PHASE: 0x2,
    TIMING_MAIN_END: 0x4,
    TIMING_BATTLE_START: 0x8,
    TIMING_BATTLE_END: 0x10,
    TIMING_END_PHASE: 0x20,
    HINT_MESSAGE: 2,
    HINT_SELECTMSG: 3,
    HINT_OPSELECTED: 4,
    HINT_NUMBER: 9,
    HINT_CARD: 10,
    HINT_ZONE: 11,
    HINTMSG_RELEASE: 500,
    HINTMSG_DISCARD: 501,
    HINTMSG_DESTROY: 502,
    HINTMSG_REMOVE: 503,
    HINTMSG_TOGRAVE: 504,
    HINTMSG_RTOHAND: 505,
    HINTMSG_ATOHAND: 506,
    HINTMSG_TOHAND: 506,
    HINTMSG_TODECK: 507,
    HINTMSG_SUMMON: 508,
    HINTMSG_SPSUMMON: 509,
    HINTMSG_SET: 510,
    HINTMSG_FMATERIAL: 511,
    HINTMSG_SMATERIAL: 512,
    HINTMSG_XMATERIAL: 513,
    HINTMSG_FACEUP: 514,
    HINTMSG_FACEDOWN: 515,
    HINTMSG_ATTACK: 516,
    HINTMSG_DEFENSE: 517,
    HINTMSG_EQUIP: 518,
    HINTMSG_REMOVEXYZ: 519,
    HINTMSG_CONTROL: 520,
    HINTMSG_DESREPLACE: 521,
    HINTMSG_FACEUPATTACK: 522,
    HINTMSG_FACEUPDEFENSE: 523,
    HINTMSG_FACEDOWNATTACK: 524,
    HINTMSG_FACEDOWNDEFENSE: 525,
    HINTMSG_CONFIRM: 526,
    HINTMSG_TOFIELD: 527,
    HINTMSG_POSCHANGE: 528,
    HINTMSG_SELF: 529,
    HINTMSG_OPPO: 530,
    HINTMSG_TRIBUTE: 531,
    HINTMSG_DEATTACHFROM: 532,
    HINTMSG_LMATERIAL: 533,
    HINTMSG_ATTACKTARGET: 549,
    HINTMSG_EFFECT: 550,
    HINTMSG_TARGET: 551,
    HINTMSG_COIN: 552,
    HINTMSG_DICE: 553,
    HINTMSG_CARDTYPE: 554,
    HINTMSG_OPTION: 555,
    HINTMSG_RESOLVEEFFECT: 556,
    HINTMSG_SELECT: 560,
    HINTMSG_POSITION: 561,
    HINTMSG_ATTRIBUTE: 562,
    HINTMSG_RACE: 563,
    HINTMSG_CODE: 564,
    HINTMSG_NUMBER: 565,
    HINTMSG_EFFACTIVATE: 566,
    HINTMSG_LVRANK: 567,
    HINTMSG_RESOLVECARD: 568,
    HINTMSG_ZONE: 569,
    HINTMSG_DISABLEZONE: 570,
    HINTMSG_TOZONE: 571,
    HINTMSG_COUNTER: 572,
    HINTMSG_NEGATE: 575,
    HINTMSG_ATKDEF: 576,
    HINTMSG_APPLYTO: 577,
    HINTMSG_ATTACH: 578,
    HINTMSG_RTOGRAVE: 579,
    PHASE_DRAW: 0x1,
    PHASE_STANDBY: 0x2,
    PHASE_MAIN1: 0x4,
    PHASE_BATTLE_START: 0x8,
    PHASE_BATTLE_STEP: 0x10,
    PHASE_DAMAGE: 0x20,
    PHASE_DAMAGE_CAL: 0x40,
    PHASE_BATTLE: 0x80,
    PHASE_MAIN2: 0x100,
    PHASE_END: 0x200,
    CHAININFO_TRIGGERING_EFFECT: 0x1,
    CHAININFO_TRIGGERING_PLAYER: 0x2,
    CHAININFO_TRIGGERING_CONTROLER: 0x4,
    CHAININFO_TRIGGERING_LOCATION: 0x8,
    CHAININFO_TRIGGERING_CARD: 0x10,
    CHAININFO_TRIGGERING_SEQUENCE: 0x20,
    CHAININFO_TARGET_CARDS: 0x40,
    CHAININFO_TARGET_PLAYER: 0x80,
    CHAININFO_TARGET_PARAM: 0x100,
    CHAININFO_CHAIN_ID: 0x200,
    CHAININFO_DISABLE_REASON: 0x400,
    CHAININFO_DISABLE_PLAYER: 0x800,
    CHAININFO_TYPE: 0x1000,
    CHAININFO_EXTTYPE: 0x2000,
    CHAININFO_TRIGGERING_POSITION: 0x4000,
    CHAININFO_TRIGGERING_CODE: 0x8000,
    CHAININFO_TRIGGERING_CODE2: 0x10000,
    CHAININFO_TRIGGERING_LEVEL: 0x40000,
    CHAININFO_TRIGGERING_RANK: 0x80000,
    CHAININFO_TRIGGERING_ATTRIBUTE: 0x100000,
    CHAININFO_TRIGGERING_RACE: 0x200000,
    CHAININFO_TRIGGERING_ATTACK: 0x400000,
    CHAININFO_TRIGGERING_DEFENSE: 0x800000,
    EFFECT_TYPE_SINGLE: 0x1,
    EFFECT_TYPE_FIELD: 0x2,
    EFFECT_TYPE_EQUIP: 0x4,
    EFFECT_TYPE_ACTIONS: 0x8,
    EFFECT_TYPE_ACTIVATE: 0x10,
    EFFECT_TYPE_FLIP: 0x20,
    EFFECT_TYPE_IGNITION: 0x40,
    EFFECT_TYPE_TRIGGER_O: 0x80,
    EFFECT_TYPE_QUICK_O: 0x100,
    EFFECT_TYPE_TRIGGER_F: 0x200,
    EFFECT_TYPE_QUICK_F: 0x400,
    EFFECT_TYPE_CONTINUOUS: 0x800,
    EFFECT_TYPE_XMATERIAL: 0x1000,
    EFFECT_TYPE_GRANT: 0x2000,
    EFFECT_TYPE_TARGET: 0x4000,
    EFFECT_IMMUNE_EFFECT: 1,
    EFFECT_DISABLE: 2,
    EFFECT_CANNOT_DISABLE: 3,
    EFFECT_SET_CONTROL: 4,
    EFFECT_CANNOT_CHANGE_CONTROL: 5,
    EFFECT_CANNOT_ACTIVATE: 6,
    EFFECT_CANNOT_TRIGGER: 7,
    EFFECT_DISABLE_EFFECT: 8,
    EFFECT_DISABLE_CHAIN: 9,
    EFFECT_DISABLE_TRAPMONSTER: 10,
    EFFECT_CANNOT_INACTIVATE: 12,
    EFFECT_CANNOT_DISEFFECT: 13,
    EFFECT_CANNOT_CHANGE_POSITION: 14,
    EFFECT_TRAP_ACT_IN_HAND: 15,
    EFFECT_TRAP_ACT_IN_SET_TURN: 16,
    EFFECT_REMAIN_FIELD: 17,
    EFFECT_MONSTER_SSET: 18,
    EFFECT_QP_ACT_IN_SET_TURN: 19,
    EFFECT_CANNOT_SUMMON: 20,
    EFFECT_CANNOT_FLIP_SUMMON: 21,
    EFFECT_CANNOT_SPECIAL_SUMMON: 22,
    EFFECT_CANNOT_MSET: 23,
    EFFECT_CANNOT_SSET: 24,
    EFFECT_CANNOT_DRAW: 25,
    EFFECT_CANNOT_DISABLE_SUMMON: 26,
    EFFECT_CANNOT_DISABLE_SPSUMMON: 27,
    EFFECT_SET_SUMMON_COUNT_LIMIT: 28,
    EFFECT_EXTRA_SUMMON_COUNT: 29,
    EFFECT_SPSUMMON_CONDITION: 30,
    EFFECT_REVIVE_LIMIT: 31,
    EFFECT_SUMMON_PROC: 32,
    EFFECT_LIMIT_SUMMON_PROC: 33,
    EFFECT_SPSUMMON_PROC: 34,
    EFFECT_EXTRA_SET_COUNT: 35,
    EFFECT_SET_PROC: 36,
    EFFECT_LIMIT_SET_PROC: 37,
    EFFECT_LIGHT_OF_INTERVENTION: 38,
    EFFECT_CANNOT_DISABLE_FLIP_SUMMON: 39,
    EFFECT_INDESTRUCTABLE: 40,
    EFFECT_INDESTRUCTABLE_EFFECT: 41,
    EFFECT_INDESTRUCTABLE_BATTLE: 42,
    EFFECT_UNRELEASABLE_SUM: 43,
    EFFECT_UNRELEASABLE_NONSUM: 44,
    EFFECT_DESTROY_SUBSTITUTE: 45,
    EFFECT_CANNOT_RELEASE: 46,
    EFFECT_INDESTRUCTABLE_COUNT: 47,
    EFFECT_UNRELEASABLE_EFFECT: 48,
    EFFECT_DESTROY_REPLACE: 50,
    EFFECT_RELEASE_REPLACE: 51,
    EFFECT_SEND_REPLACE: 52,
    EFFECT_CANNOT_DISCARD_HAND: 55,
    EFFECT_CANNOT_DISCARD_DECK: 56,
    EFFECT_CANNOT_USE_AS_COST: 57,
    EFFECT_CANNOT_PLACE_COUNTER: 58,
    EFFECT_CANNOT_TO_GRAVE_AS_COST: 59,
    EFFECT_LEAVE_FIELD_REDIRECT: 60,
    EFFECT_TO_HAND_REDIRECT: 61,
    EFFECT_TO_DECK_REDIRECT: 62,
    EFFECT_TO_GRAVE_REDIRECT: 63,
    EFFECT_REMOVE_REDIRECT: 64,
    EFFECT_CANNOT_TO_HAND: 65,
    EFFECT_CANNOT_TO_DECK: 66,
    EFFECT_CANNOT_REMOVE: 67,
    EFFECT_CANNOT_TO_GRAVE: 68,
    EFFECT_CANNOT_TURN_SET: 69,
    EFFECT_CANNOT_BE_BATTLE_TARGET: 70,
    EFFECT_CANNOT_BE_EFFECT_TARGET: 71,
    EFFECT_IGNORE_BATTLE_TARGET: 72,
    EFFECT_CANNOT_DIRECT_ATTACK: 73,
    EFFECT_DIRECT_ATTACK: 74,
    EFFECT_GEMINI_STATUS: 75,
    EFFECT_DUAL_STATUS: 75,
    EFFECT_EQUIP_LIMIT: 76,
    EFFECT_GEMINI_SUMMONABLE: 77,
    EFFECT_UNION_LIMIT: 78,
    EFFECT_REVERSE_DAMAGE: 80,
    EFFECT_REVERSE_RECOVER: 81,
    EFFECT_CHANGE_DAMAGE: 82,
    EFFECT_REFLECT_DAMAGE: 83,
    EFFECT_CANNOT_ATTACK: 85,
    EFFECT_CANNOT_ATTACK_ANNOUNCE: 86,
    EFFECT_CANNOT_CHANGE_POS_E: 87,
    EFFECT_ACTIVATE_COST: 90,
    EFFECT_SUMMON_COST: 91,
    EFFECT_SPSUMMON_COST: 92,
    EFFECT_FLIPSUMMON_COST: 93,
    EFFECT_MSET_COST: 94,
    EFFECT_SSET_COST: 95,
    EFFECT_ATTACK_COST: 96,
    EFFECT_UPDATE_ATTACK: 100,
    EFFECT_SET_ATTACK: 101,
    EFFECT_SET_ATTACK_FINAL: 102,
    EFFECT_SET_BASE_ATTACK: 103,
    EFFECT_UPDATE_DEFENSE: 104,
    EFFECT_SET_DEFENSE: 105,
    EFFECT_SET_DEFENSE_FINAL: 106,
    EFFECT_SET_BASE_DEFENSE: 107,
    EFFECT_REVERSE_UPDATE: 108,
    EFFECT_SWAP_AD: 109,
    EFFECT_SWAP_BASE_AD: 110,
    EFFECT_SWAP_ATTACK_FINAL: 111,
    EFFECT_SWAP_DEFENSE_FINAL: 112,
    EFFECT_ADD_CODE: 113,
    EFFECT_CHANGE_CODE: 114,
    EFFECT_ADD_TYPE: 115,
    EFFECT_REMOVE_TYPE: 116,
    EFFECT_CHANGE_TYPE: 117,
    EFFECT_REMOVE_CODE: 118,
    EFFECT_ADD_RACE: 120,
    EFFECT_REMOVE_RACE: 121,
    EFFECT_CHANGE_RACE: 122,
    EFFECT_ADD_ATTRIBUTE: 125,
    EFFECT_REMOVE_ATTRIBUTE: 126,
    EFFECT_CHANGE_ATTRIBUTE: 127,
    EFFECT_UPDATE_LEVEL: 130,
    EFFECT_CHANGE_LEVEL: 131,
    EFFECT_UPDATE_RANK: 132,
    EFFECT_CHANGE_RANK: 133,
    EFFECT_UPDATE_LSCALE: 134,
    EFFECT_CHANGE_LSCALE: 135,
    EFFECT_UPDATE_RSCALE: 136,
    EFFECT_CHANGE_RSCALE: 137,
    EFFECT_SET_POSITION: 140,
    EFFECT_SELF_DESTROY: 141,
    EFFECT_SELF_TOGRAVE: 142,
    EFFECT_DOUBLE_TRIBUTE: 150,
    EFFECT_DECREASE_TRIBUTE: 151,
    EFFECT_DECREASE_TRIBUTE_SET: 152,
    EFFECT_EXTRA_RELEASE: 153,
    EFFECT_TRIBUTE_LIMIT: 154,
    EFFECT_EXTRA_RELEASE_SUM: 155,
    EFFECT_TRIPLE_TRIBUTE: 156,
    EFFECT_ADD_EXTRA_TRIBUTE: 157,
    EFFECT_EXTRA_RELEASE_NONSUM: 158,
    EFFECT_PUBLIC: 160,
    EFFECT_LPCOST_CHANGE: 170,
    EFFECT_LPCOST_REPLACE: 171,
    EFFECT_SKIP_DP: 180,
    EFFECT_SKIP_SP: 181,
    EFFECT_SKIP_M1: 182,
    EFFECT_SKIP_BP: 183,
    EFFECT_SKIP_M2: 184,
    EFFECT_CANNOT_BP: 185,
    EFFECT_CANNOT_M2: 186,
    EFFECT_CANNOT_EP: 187,
    EFFECT_SKIP_TURN: 188,
    EFFECT_SKIP_EP: 189,
    EFFECT_DEFENSE_ATTACK: 190,
    EFFECT_MUST_ATTACK: 191,
    EFFECT_FIRST_ATTACK: 192,
    EFFECT_ATTACK_ALL: 193,
    EFFECT_EXTRA_ATTACK: 194,
    EFFECT_ONLY_BE_ATTACKED: 196,
    EFFECT_ATTACK_DISABLED: 197,
    EFFECT_CHANGE_BATTLE_STAT: 198,
    EFFECT_NO_BATTLE_DAMAGE: 200,
    EFFECT_AVOID_BATTLE_DAMAGE: 201,
    EFFECT_REFLECT_BATTLE_DAMAGE: 202,
    EFFECT_PIERCE: 203,
    EFFECT_BATTLE_DESTROY_REDIRECT: 204,
    EFFECT_BATTLE_DAMAGE_TO_EFFECT: 205,
    EFFECT_BOTH_BATTLE_DAMAGE: 206,
    EFFECT_ALSO_BATTLE_DAMAGE: 207,
    EFFECT_CHANGE_BATTLE_DAMAGE: 208,
    EFFECT_TOSS_COIN_REPLACE: 220,
    EFFECT_TOSS_DICE_REPLACE: 221,
    EFFECT_TOSS_COIN_CHOOSE: 222,
    EFFECT_TOSS_DICE_CHOOSE: 223,
    EFFECT_FUSION_MATERIAL: 230,
    EFFECT_CHAIN_MATERIAL: 231,
    EFFECT_SYNCHRO_MATERIAL: 232,
    EFFECT_XYZ_MATERIAL: 233,
    EFFECT_FUSION_SUBSTITUTE: 234,
    EFFECT_CANNOT_BE_FUSION_MATERIAL: 235,
    EFFECT_CANNOT_BE_SYNCHRO_MATERIAL: 236,
    EFFECT_SYNCHRO_MATERIAL_CUSTOM: 237,
    EFFECT_CANNOT_BE_XYZ_MATERIAL: 238,
    EFFECT_CANNOT_BE_LINK_MATERIAL: 239,
    EFFECT_SYNCHRO_LEVEL: 240,
    EFFECT_RITUAL_LEVEL: 241,
    EFFECT_XYZ_LEVEL: 242,
    EFFECT_EXTRA_RITUAL_MATERIAL: 243,
    EFFECT_NONTUNER: 244,
    EFFECT_OVERLAY_REMOVE_REPLACE: 245,
    EFFECT_CANNOT_BE_MATERIAL: 248,
    EFFECT_PRE_MONSTER: 250,
    EFFECT_MATERIAL_CHECK: 251,
    EFFECT_DISABLE_FIELD: 260,
    EFFECT_USE_EXTRA_MZONE: 261,
    EFFECT_USE_EXTRA_SZONE: 262,
    EFFECT_MAX_MZONE: 263,
    EFFECT_MAX_SZONE: 264,
    EFFECT_FORCE_MZONE: 265,
    EFFECT_BECOME_LINKED_ZONE: 266,
    EFFECT_HAND_LIMIT: 270,
    EFFECT_DRAW_COUNT: 271,
    EFFECT_SPIRIT_DONOT_RETURN: 280,
    EFFECT_SPIRIT_MAYNOT_RETURN: 281,
    EFFECT_CHANGE_ENVIRONMENT: 290,
    EFFECT_NECRO_VALLEY: 291,
    EFFECT_FORBIDDEN: 292,
    EFFECT_NECRO_VALLEY_IM: 293,
    EFFECT_REVERSE_DECK: 294,
    EFFECT_REMOVE_BRAINWASHING: 295,
    EFFECT_BP_TWICE: 296,
    EFFECT_UNIQUE_CHECK: 297,
    EFFECT_MATCH_KILL: 300,
    EFFECT_SYNCHRO_CHECK: 310,
    EFFECT_QP_ACT_IN_NTPHAND: 311,
    EFFECT_MUST_BE_SMATERIAL: 312,
    EFFECT_TO_GRAVE_REDIRECT_CB: 313,
    EFFECT_CHANGE_LEVEL_FINAL: 314,
    EFFECT_CHANGE_RANK_FINAL: 315,
    EFFECT_MUST_BE_FMATERIAL: 316,
    EFFECT_MUST_BE_MATERIAL: 317,
    EFFECT_MUST_BE_XMATERIAL: 317,
    EFFECT_MUST_BE_LMATERIAL: 318,
    EFFECT_SPSUMMON_PROC_G: 320,
    EFFECT_SPSUMMON_COUNT_LIMIT: 330,
    EFFECT_LEFT_SPSUMMON_COUNT: 331,
    EFFECT_CANNOT_SELECT_BATTLE_TARGET: 332,
    EFFECT_CANNOT_SELECT_EFFECT_TARGET: 333,
    EFFECT_ADD_SETCODE: 334,
    EFFECT_NO_EFFECT_DAMAGE: 335,
    EFFECT_UNSUMMONABLE_CARD: 336,
    EFFECT_DISCARD_COST_CHANGE: 338,
    EFFECT_HAND_SYNCHRO: 339,
    EFFECT_ONLY_ATTACK_MONSTER: 343,
    EFFECT_MUST_ATTACK_MONSTER: 344,
    EFFECT_PATRICIAN_OF_DARKNESS: 345,
    EFFECT_EXTRA_ATTACK_MONSTER: 346,
    EFFECT_UNION_STATUS: 347,
    EFFECT_OLDUNION_STATUS: 348,
    EFFECT_REMOVE_SETCODE: 349,
    EFFECT_CHANGE_SETCODE: 350,
    EFFECT_EXTRA_FUSION_MATERIAL: 352,
    EFFECT_ADD_LINK_CODE: 354,
    EFFECT_ADD_LINK_SETCODE: 355,
    EFFECT_EXTRA_MATERIAL: 358,
    EFFECT_EXTRA_PENDULUM_SUMMON: 360,
    EFFECT_IRON_WALL: 361,
    EFFECT_CANNOT_LOSE_DECK: 400,
    EFFECT_CANNOT_LOSE_LP: 401,
    EFFECT_CANNOT_LOSE_EFFECT: 402,
    EFFECT_BP_FIRST_TURN: 403,
    EFFECT_UNSTOPPABLE_ATTACK: 404,
    EFFECT_ALLOW_NEGATIVE: 405,
    EFFECT_SELF_ATTACK: 406,
    EFFECT_BECOME_QUICK: 407,
    EFFECT_LEVEL_RANK: 408,
    EFFECT_RANK_LEVEL: 409,
    EFFECT_LEVEL_RANK_S: 410,
    EFFECT_RANK_LEVEL_S: 411,
    EFFECT_UPDATE_LINK: 420,
    EFFECT_CHANGE_LINK: 421,
    EFFECT_CHANGE_LINK_FINAL: 422,
    EFFECT_ADD_LINKMARKER: 423,
    EFFECT_REMOVE_LINKMARKER: 424,
    SUMMON_TYPE_NORMAL: 0x10000000,
    SUMMON_TYPE_ADVANCE: 0x11000000,
    SUMMON_TYPE_TRIBUTE: 0x11000000,
    SUMMON_TYPE_FLIP: 0x20000000,
    SUMMON_TYPE_SPECIAL: 0x40000000,
    SUMMON_TYPE_FUSION: 0x43000000,
    SUMMON_TYPE_RITUAL: 0x45000000,
    SUMMON_TYPE_SYNCHRO: 0x46000000,
    SUMMON_TYPE_XYZ: 0x49000000,
    SUMMON_TYPE_LINK: 0x4c000000,
    EVENT_STARTUP: 1000,
    EVENT_FLIP: 1001,
    EVENT_FREE_CHAIN: 1002,
    EVENT_DESTROY: 1010,
    EVENT_REMOVE: 1011,
    EVENT_TO_HAND: 1012,
    EVENT_TO_DECK: 1013,
    EVENT_TO_GRAVE: 1014,
    EVENT_LEAVE_FIELD: 1015,
    EVENT_CHANGE_POS: 1016,
    EVENT_RELEASE: 1017,
    EVENT_DISCARD: 1018,
    EVENT_LEAVE_FIELD_P: 1019,
    EVENT_CHAIN_SOLVING: 1020,
    EVENT_CHAIN_ACTIVATING: 1021,
    EVENT_CHAIN_SOLVED: 1022,
    EVENT_CHAIN_NEGATED: 1024,
    EVENT_CHAIN_DISABLED: 1025,
    EVENT_CHAIN_END: 1026,
    EVENT_CHAINING: 1027,
    EVENT_BECOME_TARGET: 1028,
    EVENT_DESTROYED: 1029,
    EVENT_MOVE: 1030,
    EVENT_ADJUST: 1040,
    EVENT_BREAK_EFFECT: 1050,
    EVENT_SUMMON_SUCCESS: 1100,
    EVENT_FLIP_SUMMON_SUCCESS: 1101,
    EVENT_SPSUMMON_SUCCESS: 1102,
    EVENT_SUMMON: 1103,
    EVENT_FLIP_SUMMON: 1104,
    EVENT_SPSUMMON: 1105,
    EVENT_MSET: 1106,
    EVENT_SSET: 1107,
    EVENT_BE_MATERIAL: 1108,
    EVENT_BE_PRE_MATERIAL: 1109,
    EVENT_DRAW: 1110,
    EVENT_DAMAGE: 1111,
    EVENT_RECOVER: 1112,
    EVENT_PREDRAW: 1113,
    EVENT_SUMMON_NEGATED: 1114,
    EVENT_FLIP_SUMMON_NEGATED: 1115,
    EVENT_SPSUMMON_NEGATED: 1116,
    EVENT_CONTROL_CHANGED: 1120,
    EVENT_EQUIP: 1121,
    EVENT_ATTACK_ANNOUNCE: 1130,
    EVENT_BE_BATTLE_TARGET: 1131,
    EVENT_BATTLE_START: 1132,
    EVENT_BATTLE_CONFIRM: 1133,
    EVENT_PRE_DAMAGE_CALCULATE: 1134,
    EVENT_PRE_BATTLE_DAMAGE: 1136,
    EVENT_BATTLED: 1138,
    EVENT_BATTLE_DESTROYING: 1139,
    EVENT_BATTLE_DESTROYED: 1140,
    EVENT_DAMAGE_STEP_END: 1141,
    EVENT_ATTACK_DISABLED: 1142,
    EVENT_BATTLE_DAMAGE: 1143,
    EVENT_TOSS_DICE: 1150,
    EVENT_TOSS_COIN: 1151,
    EVENT_TOSS_COIN_NEGATE: 1152,
    EVENT_TOSS_DICE_NEGATE: 1153,
    EVENT_LEVEL_UP: 1200,
    EVENT_PAY_LPCOST: 1201,
    EVENT_DETACH_MATERIAL: 1202,
    EVENT_RETURN_TO_GRAVE: 1203,
    EVENT_TURN_END: 1210,
    EVENT_PHASE: 0x1000,
    EVENT_PHASE_START: 0x2000,
    EVENT_ADD_COUNTER: 0x10000,
    EVENT_REMOVE_COUNTER: 0x20000,
    EVENT_CUSTOM: 0x10000000,
    REASON_DESTROY: 0x1,
    REASON_RELEASE: 0x2,
    REASON_TEMPORARY: 0x4,
    REASON_MATERIAL: 0x8,
    REASON_SUMMON: 0x10,
    REASON_BATTLE: 0x20,
    REASON_EFFECT: 0x40,
    REASON_COST: 0x80,
    REASON_ADJUST: 0x100,
    REASON_LOST_TARGET: 0x200,
    REASON_RULE: 0x400,
    REASON_SPSUMMON: 0x800,
    REASON_DISSUMMON: 0x1000,
    REASON_FLIP: 0x2000,
    REASON_DISCARD: 0x4000,
    REASON_RETURN: 0x20000,
    REASON_FUSION: 0x40000,
    REASON_SYNCHRO: 0x80000,
    REASON_RITUAL: 0x100000,
    REASON_XYZ: 0x200000,
    REASON_REPLACE: 0x1000000,
    REASON_DRAW: 0x2000000,
    REASON_REDIRECT: 0x4000000,
    REASON_EXCAVATE: 0x8000000,
    REASON_REVEAL: 0x8000000,
    REASON_LINK: 0x10000000,
    RESET_EVENT: 0x1000,
    RESET_CARD: 0x2000,
    RESET_CODE: 0x4000,
    RESET_COPY: 0x8000,
    RESET_DISABLE: 0x10000,
    RESET_TURN_SET: 0x20000,
    RESET_TOGRAVE: 0x40000,
    RESET_REMOVE: 0x80000,
    RESET_TEMP_REMOVE: 0x100000,
    RESET_TOHAND: 0x200000,
    RESET_TODECK: 0x400000,
    RESET_LEAVE: 0x800000,
    RESET_TOFIELD: 0x1000000,
    RESETS_STANDARD_EXC_GRAVE: 0x17a0000,
    RESETS_CANNOT_ACT: 0x17e0000,
    RESETS_STANDARD: 0x1fe0000,
    RESETS_STANDARD_DISABLE: 0x1ff0000,
    RESET_CONTROL: 0x2000000,
    RESET_OVERLAY: 0x4000000,
    RESETS_REDIRECT: 0x47e0000,
    RESET_MSCHANGE: 0x8000000,
    RESET_SELF_TURN: 0x10000000,
    RESET_OPPO_TURN: 0x20000000,
    RESET_PHASE: 0x40000000,
    RESETS_STANDARD_PHASE_END: 0x41fe1200,
    RESETS_STANDARD_DISABLE_PHASE_END: 0x41ff1200,
    RESET_CHAIN: 0x80000000,
    EFFECT_COUNT_CODE_OATH: 0x1,
    EFFECT_COUNT_CODE_DUEL: 0x2,
    EFFECT_COUNT_CODE_SINGLE: 0x4,
    ACTIVITY_SUMMON: duelActivity.summon,
    ACTIVITY_NORMALSUMMON: duelActivity.normalSummon,
    ACTIVITY_SPSUMMON: duelActivity.specialSummon,
    ACTIVITY_FLIPSUMMON: duelActivity.flipSummon,
    ACTIVITY_ATTACK: duelActivity.attack,
  };
  for (const [name, value] of Object.entries(constants)) {
    pushLuaNumericConstant(L, value);
    lua.lua_setglobal(L, to_luastring(name));
  }
}

function pushLuaNumericConstant(L: unknown, value: number): void {
  if (Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff) lua.lua_pushinteger(L, value);
  else lua.lua_pushnumber(L, value);
}

export function installDebugApi(L: unknown, messages: string[]): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const message = lua.lua_isstring(state, 1) ? lua.lua_tojsstring(state, 1) : "";
    messages.push(message);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("Message"));
  lua.lua_setglobal(L, to_luastring("Debug"));
}

export function installAuxApi(L: unknown, readLuaError: (state: unknown) => string): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const code = lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : 0;
    const index = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, code * 16 + index);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Stringid"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, true);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("TRUE"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, false);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("FALSE"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (!lua.lua_isfunction(state, 1)) {
      lua.lua_pushnil(state);
      return 1;
    }
    const extraArgCount = lua.lua_gettop(state) - 1;
    const refs: number[] = [];
    lua.lua_pushvalue(state, 1);
    refs.push(lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX));
    for (let index = 0; index < extraArgCount; index += 1) {
      lua.lua_pushvalue(state, index + 2);
      refs.push(lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX));
    }
    lua.lua_pushjsfunction(state, (callState: unknown) => {
      lua.lua_rawgeti(callState, lua.LUA_REGISTRYINDEX, refs[0]);
      lua.lua_pushvalue(callState, 1);
      for (let index = 1; index < refs.length; index += 1) lua.lua_rawgeti(callState, lua.LUA_REGISTRYINDEX, refs[index]);
      const status = lua.lua_pcall(callState, refs.length, 1, 0);
      if (status !== lua.LUA_OK) return lauxlib.luaL_error(callState, to_luastring(readLuaError(callState)));
      return 1;
    });
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("FilterBoolFunction"));
  pushFixedFilterWrapper(L, "FilterBoolFunctionEx", readLuaError, false);
  pushFixedFilterWrapper(L, "TargetBoolFunction", readLuaError, false);
  pushFixedFilterWrapper(L, "FaceupFilter", readLuaError, true);
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectUnselectGroup(state));
  lua.lua_setfield(L, -2, to_luastring("SelectUnselectGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAuxNext(state));
  lua.lua_setfield(L, -2, to_luastring("Next"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSpElimFilter(state, readLuaError));
  lua.lua_setfield(L, -2, to_luastring("SpElimFilter"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (!lua.lua_isfunction(state, 1)) {
      lua.lua_pushnil(state);
      return 1;
    }
    lua.lua_pushvalue(state, 1);
    const ref = lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX);
    lua.lua_pushjsfunction(state, (callState: unknown) => {
      const argCount = lua.lua_gettop(callState);
      lua.lua_rawgeti(callState, lua.LUA_REGISTRYINDEX, ref);
      for (let index = 1; index <= argCount; index += 1) lua.lua_pushvalue(callState, index);
      const status = lua.lua_pcall(callState, argCount, 1, 0);
      if (status !== lua.LUA_OK) return lauxlib.luaL_error(callState, to_luastring(readLuaError(callState)));
      return 1;
    });
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("NecroValleyFilter"));
  lua.lua_setglobal(L, to_luastring("aux"));
}

function pushSpElimFilter(L: unknown, readLuaError: (state: unknown) => string): number {
  const mustBeFaceup = lua.lua_toboolean(L, 2);
  const includeMonsterZone = lua.lua_toboolean(L, 3);
  const isMonster = callLuaBooleanMethod(L, 1, "IsMonster", readLuaError);
  if (!isMonster) {
    lua.lua_pushboolean(L, includeMonsterZone || callLuaBooleanMethod(L, 1, "IsLocation", readLuaError, 0x10));
    return 1;
  }
  const inMonsterZone = callLuaBooleanMethod(L, 1, "IsLocation", readLuaError, 0x04);
  if (mustBeFaceup && inMonsterZone && callLuaBooleanMethod(L, 1, "IsFacedown", readLuaError)) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const affectedBySpiritElimination = callIsPlayerAffectedByEffect(L, 1, 69832741, readLuaError);
  const inGraveyard = callLuaBooleanMethod(L, 1, "IsLocation", readLuaError, 0x10);
  lua.lua_pushboolean(L, includeMonsterZone ? inMonsterZone || !affectedBySpiritElimination : affectedBySpiritElimination ? inMonsterZone : inGraveyard);
  return 1;
}

function callIsPlayerAffectedByEffect(L: unknown, cardIndex: number, code: number, readLuaError: (state: unknown) => string): boolean {
  const top = lua.lua_gettop(L);
  lua.lua_getglobal(L, to_luastring("Duel"));
  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, lua.lua_gettop(L) - top);
    return false;
  }
  lua.lua_getfield(L, -1, to_luastring("IsPlayerAffectedByEffect"));
  if (!lua.lua_isfunction(L, -1)) {
    lua.lua_pop(L, lua.lua_gettop(L) - top);
    return false;
  }
  const player = callLuaNumberMethod(L, cardIndex, "GetControler", readLuaError);
  lua.lua_pushinteger(L, player);
  lua.lua_pushinteger(L, code);
  const status = lua.lua_pcall(L, 2, 1, 0);
  if (status !== lua.LUA_OK) return Boolean(lauxlib.luaL_error(L, to_luastring(readLuaError(L))));
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, lua.lua_gettop(L) - top);
  return Boolean(result);
}

function callLuaBooleanMethod(L: unknown, tableIndex: number, methodName: string, readLuaError: (state: unknown) => string, ...args: number[]): boolean {
  const top = lua.lua_gettop(L);
  const absoluteIndex = lua.lua_absindex(L, tableIndex);
  lua.lua_getfield(L, absoluteIndex, to_luastring(methodName));
  if (!lua.lua_isfunction(L, -1)) {
    lua.lua_pop(L, lua.lua_gettop(L) - top);
    return false;
  }
  lua.lua_pushvalue(L, absoluteIndex);
  for (const arg of args) lua.lua_pushinteger(L, arg);
  const status = lua.lua_pcall(L, args.length + 1, 1, 0);
  if (status !== lua.LUA_OK) return Boolean(lauxlib.luaL_error(L, to_luastring(readLuaError(L))));
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, lua.lua_gettop(L) - top);
  return Boolean(result);
}

function callLuaNumberMethod(L: unknown, tableIndex: number, methodName: string, readLuaError: (state: unknown) => string): number {
  const top = lua.lua_gettop(L);
  const absoluteIndex = lua.lua_absindex(L, tableIndex);
  lua.lua_getfield(L, absoluteIndex, to_luastring(methodName));
  if (!lua.lua_isfunction(L, -1)) {
    lua.lua_pop(L, lua.lua_gettop(L) - top);
    return 0;
  }
  lua.lua_pushvalue(L, absoluteIndex);
  const status = lua.lua_pcall(L, 1, 1, 0);
  if (status !== lua.LUA_OK) return Number(lauxlib.luaL_error(L, to_luastring(readLuaError(L))));
  const result = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : 0;
  lua.lua_pop(L, lua.lua_gettop(L) - top);
  return result;
}

function pushAuxNext(L: unknown): number {
  const uids = readGroupUids(L, 1);
  let index = 0;
  lua.lua_pushjsfunction(L, (state: unknown) => {
    const uid = uids[index];
    index += 1;
    if (!uid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, uid);
    return 1;
  });
  return 1;
}

function pushSelectUnselectGroup(L: unknown): number {
  const uids = readGroupUids(L, 1);
  const min = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1;
  const max = lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : min;
  const filterRef = readOptionalFunctionRef(L, 7);
  const selected = filterRef === undefined ? selectGroupUids(uids, min, max) : selectSubGroup(L, uids, filterRef, min, max, 8) ?? [];
  releaseOptionalFunctionRef(L, filterRef);
  pushGroupTable(L, selected);
  return 1;
}

function selectGroupUids(uids: string[], min: number, max: number): string[] {
  const boundedMin = Math.max(0, min);
  if (uids.length < boundedMin) return [];
  const limit = max > 0 ? Math.max(boundedMin, max) : uids.length;
  return uids.slice(0, limit);
}

function selectSubGroup(L: unknown, uids: string[], filterRef: number, min: number, max: number, argsStart: number): string[] | undefined {
  const boundedMin = Math.max(0, min);
  const boundedMax = Math.max(boundedMin, max > 0 ? max : uids.length);
  return findSubGroupSelection(L, uids, filterRef, boundedMin, boundedMax, argsStart, 0, []);
}

function findSubGroupSelection(L: unknown, uids: string[], filterRef: number, min: number, max: number, argsStart: number, index: number, selected: string[]): string[] | undefined {
  if (selected.length >= min && selected.length <= max && auxGroupPredicateMatches(L, selected, filterRef, argsStart)) return [...selected];
  if (index >= uids.length || selected.length >= max) return undefined;
  for (let nextIndex = index; nextIndex < uids.length; nextIndex += 1) {
    const uid = uids[nextIndex];
    if (!uid) continue;
    selected.push(uid);
    const found = findSubGroupSelection(L, uids, filterRef, min, max, argsStart, nextIndex + 1, selected);
    if (found) return found;
    selected.pop();
  }
  return undefined;
}

function auxGroupPredicateMatches(L: unknown, uids: string[], filterRef: number, argsStart: number): boolean {
  const top = lua.lua_gettop(L);
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushGroupTable(L, uids);
  for (let index = argsStart; index <= top; index += 1) lua.lua_pushvalue(L, index);
  const status = lua.lua_pcall(L, Math.max(1, top - argsStart + 2), 1, 0);
  if (status !== lua.LUA_OK) return false;
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function pushFixedFilterWrapper(L: unknown, fieldName: string, readLuaError: (state: unknown) => string, requireFaceup: boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (!lua.lua_isfunction(state, 1)) {
      lua.lua_pushnil(state);
      return 1;
    }
    const extraArgCount = lua.lua_gettop(state) - 1;
    const refs: number[] = [];
    lua.lua_pushvalue(state, 1);
    refs.push(lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX));
    for (let index = 0; index < extraArgCount; index += 1) {
      lua.lua_pushvalue(state, index + 2);
      refs.push(lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX));
    }
    lua.lua_pushjsfunction(state, (callState: unknown) => {
      if (requireFaceup && !isLuaCardFaceup(callState, readLuaError)) {
        lua.lua_pushboolean(callState, false);
        return 1;
      }
      const runtimeArgCount = lua.lua_gettop(callState);
      lua.lua_rawgeti(callState, lua.LUA_REGISTRYINDEX, refs[0]);
      if (runtimeArgCount > 0) lua.lua_pushvalue(callState, 1);
      for (let index = 1; index < refs.length; index += 1) lua.lua_rawgeti(callState, lua.LUA_REGISTRYINDEX, refs[index]);
      for (let index = 2; index <= runtimeArgCount; index += 1) lua.lua_pushvalue(callState, index);
      const status = lua.lua_pcall(callState, runtimeArgCount + refs.length - 1, 1, 0);
      if (status !== lua.LUA_OK) return lauxlib.luaL_error(callState, to_luastring(readLuaError(callState)));
      return 1;
    });
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function isLuaCardFaceup(L: unknown, readLuaError: (state: unknown) => string): boolean {
  if (!lua.lua_istable(L, 1)) return false;
  lua.lua_getfield(L, 1, to_luastring("IsFaceup"));
  if (!lua.lua_isfunction(L, -1)) {
    lua.lua_pop(L, 1);
    return false;
  }
  lua.lua_pushvalue(L, 1);
  const status = lua.lua_pcall(L, 1, 1, 0);
  if (status !== lua.LUA_OK) return Boolean(lauxlib.luaL_error(L, to_luastring(readLuaError(L))));
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

import type { CardSummary, PlaytestLogEntry } from "#engine/types.js";
import type { DuelAction } from "#duel/types.js";

export interface CardImageInfo {
  small: string;
  large: string;
}

export interface ToastMessage {
  id: number;
  title: string;
  message: string;
  tone: "default" | "success" | "warning" | "error";
}

export interface ZoomCard {
  uid?: string;
  name: string;
  image: string;
}

export interface PileView {
  title: string;
  icon: string;
  cards: CardSummary[];
  faceDown?: boolean;
}

export const AUTO_DECK_KEY = "duelDeckStudio.autoDeck.v1";

export const starterYdk = `#created by Duel Deck Studio
#deck Dark Magical Blast - TCG Branded DM
#main
46986414
46986414
38033121
97631303
97631303
97631303
7084129
7084129
7084129
12266229
12266229
12266229
30603688
3078380
74677422
68468459
68468459
14558127
14558127
14558127
23020408
23020408
23020408
47222536
47222536
47222536
95477924
95477924
96729612
96729612
59514116
1784686
11827244
6172122
44362883
44362883
24224830
65681983
48680970
48680970
#extra
50237654
50237654
41721210
85059922
37818794
73452089
84433295
44146295
70534340
87746184
24915933
96471335
44405066
8264361
29301450
!side`;

export function LogPanel(props: { log: PlaytestLogEntry[] }) {
  return (
    <section className="tcg-panel rounded-xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#d4af37]/60">History</p>
          <h2 className="font-['Cinzel'] text-base font-bold text-[#fff7dc]">Action Log</h2>
        </div>
        <span className="tcg-badge rounded-full px-2.5 py-1 text-xs">{props.log.length}</span>
      </div>
      <ol className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
        {props.log.length ? props.log.map((entry) => (
          <li key={`${entry.step}-${entry.action}-${entry.detail}`} className="log-entry grid grid-cols-[28px_minmax(0,1fr)] gap-2 rounded-lg p-2.5">
            <span className="grid h-6 place-items-center rounded-md bg-[#d4af37]/15 text-[10px] font-black text-[#d4af37]">
              {entry.step}
            </span>
            <span className="min-w-0">
              <strong className="block truncate text-sm text-[#fff7dc]">
                {entry.action}{entry.card ? ` · ${entry.card}` : ""}
              </strong>
              <small className="block text-xs text-[#c7b98f]/70">{entry.detail}</small>
            </span>
          </li>
        )) : (
          <li className="empty-state rounded-lg px-4 py-8 text-center text-sm">
            Start a duel to see the action log
          </li>
        )}
      </ol>
    </section>
  );
}

export function CardZoom(props: {
  card: ZoomCard;
  actions?: readonly DuelAction[];
  actionTitle?: string;
  onAction?: (action: DuelAction) => void;
  onClose: () => void;
}) {
  const actions = props.actions ?? [];
  return (
    <div className="card-zoom-overlay fixed inset-0 z-50 grid place-items-center p-4" onClick={props.onClose}>
      <div
        className="card-zoom-frame relative grid max-h-[92dvh] w-[min(94vw,900px)] grid-cols-1 gap-4 overflow-hidden rounded-xl p-4 shadow-2xl md:grid-cols-[minmax(260px,420px)_minmax(220px,1fr)]"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="absolute -right-3 -top-3 grid size-10 place-items-center rounded-full border-2 border-[#d4af37]/50 bg-black text-xl font-bold text-white shadow-lg transition-colors hover:border-[#d4af37] hover:bg-[#d4af37]/20"
          type="button"
          aria-label="Close card preview"
          onClick={props.onClose}
        >
          ×
        </button>
        <img
          className="mx-auto max-h-[78dvh] w-full max-w-[420px] rounded-lg object-contain"
          src={props.card.image}
          alt={props.card.name}
        />
        <div className="flex min-h-0 flex-col">
          <p className="font-['Cinzel'] text-xl font-bold leading-tight text-[#fff7dc]">{props.card.name}</p>
          {actions.length > 0 && props.onAction ? (
            <>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#d4af37]/70">
                {props.actionTitle ?? "Available Actions"}
              </p>
              <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {actions.map((action) => (
                  <button
                    key={JSON.stringify(action)}
                    type="button"
                    className="action-button w-full rounded-lg px-3 py-3 text-left text-xs font-semibold leading-snug sm:text-sm"
                    onClick={() => props.onAction?.(action)}
                  >
                    <span className="line-clamp-4">{action.label}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ToastStack(props: { toasts: ToastMessage[] }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex w-[min(380px,calc(100vw-2.5rem))] flex-col gap-3">
      {props.toasts.map((toast) => (
        <div key={toast.id} className={`rounded-xl px-5 py-4 shadow-xl ${toastClass(toast.tone)}`}>
          <strong className="block text-sm font-bold">{toast.title}</strong>
          <small className="block text-xs opacity-80">{toast.message}</small>
        </div>
      ))}
    </div>
  );
}

export function readBuilderDeck(): { ydk: string; mainCount: number; extraCount: number } | null {
  const raw = localStorage.getItem(AUTO_DECK_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { deckName?: string; deck?: { main?: Record<string, number>; extra?: Record<string, number>; side?: Record<string, number> } };
    const main = expandZone(parsed.deck?.main);
    const extra = expandZone(parsed.deck?.extra);
    const side = expandZone(parsed.deck?.side);
    if (!main.length && !extra.length) return null;
    return {
      ydk: [
        "#created by Duel Deck Studio",
        `#deck ${parsed.deckName || "Builder Deck"}`,
        "#main",
        ...main,
        "#extra",
        ...extra,
        "!side",
        ...side,
      ].join("\n"),
      mainCount: main.length,
      extraCount: extra.length,
    };
  } catch {
    return null;
  }
}

function expandZone(zone: Record<string, number> | undefined): string[] {
  if (!zone) return [];
  return Object.entries(zone).flatMap(([id, count]) => Array.from({ length: Math.max(0, Number(count) || 0) }, () => id));
}

export function getCardTypeClass(card: CardSummary): string {
  if (card.type === "spell") return "spell-card";
  if (card.type === "trap") return "trap-card";
  if (card.type === "extra") return "extra-card";
  return "";
}

export function cardToneBg(card: CardSummary): string {
  if (card.type === "spell") return "bg-[#1d8a6e]";
  if (card.type === "trap") return "bg-[#a12962]";
  if (card.type === "extra") return "bg-[#7b2d8e]";
  return "bg-[#b85c1e]";
}

export function qualityClass(quality: string): string {
  if (quality === "strong") return "quality-strong";
  if (quality === "playable") return "quality-playable";
  if (quality === "thin") return "quality-thin";
  if (quality === "weak") return "quality-weak";
  return "quality-waiting";
}

function toastClass(tone: ToastMessage["tone"]): string {
  if (tone === "success") return "toast-success";
  if (tone === "warning") return "toast-warning";
  if (tone === "error") return "toast-error";
  return "toast-default";
}

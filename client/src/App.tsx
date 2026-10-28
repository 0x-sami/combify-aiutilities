import { useCallback, useEffect, useRef, useState } from "react";

interface EndpointDef {
  id: string;
  method: "GET" | "POST";
  cap: string;
  title: string;
  use: string;
  example: string;
  icon: React.ReactNode;
}

const ICON_PATHS: Record<string, React.ReactNode> = {
  pulse: <path d="M2 12h4l3-9 4 18 3-9h6" />,
  activity: (
    <>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </>
  ),
  key: (
    <>
      <path d="M21 2l-2 2" />
      <path d="M7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </>
  ),
  dice: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  pin: (
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  chain: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  echo: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  hash: (
    <>
      <path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />
    </>
  ),
  block: (
    <>
      <path d="M12 2l9 5v10l-9 5-9-5V7z" />
      <path d="M12 12l9-5M12 12v10M12 12L3 7" />
    </>
  ),
  code: (
    <>
      <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      <path d="M8 12h8" />
    </>
  ),
  text: (
    <>
      <path d="M4 7V4h16v3M9 20h6M12 4v16" />
    </>
  ),
  receipt: (
    <>
      <path d="M4 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2z" />
      <path d="M8 9h8M8 13h6" />
    </>
  ),
  tag: (
    <>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <circle cx="7" cy="7" r="1" fill="currentColor" />
    </>
  ),
  doc: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </>
  ),
  pen: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
    </>
  ),
  keys: (
    <>
      <path d="M4 6h16M4 12h10M4 18h7" />
      <circle cx="18" cy="15" r="3" />
    </>
  ),
  tree: (
    <>
      <path d="M4 6h6M4 12h16M4 18h10" />
      <path d="M14 4v4M20 10v4M16 16v4" />
    </>
  ),
};

const ENDPOINTS: EndpointDef[] = [
  // Utility
  { id: "ping", method: "GET", cap: "Utility", title: "Ping", use: "Health-check the service and confirm the payment stack is up.", example: "", icon: ICON_PATHS.pulse },
  { id: "status", method: "GET", cap: "Utility", title: "Status", use: "Service status plus the active payment configuration.", example: "", icon: ICON_PATHS.activity },
  // Data
  { id: "time", method: "GET", cap: "Data", title: "Server Time", use: "Current UTC time as an ISO string and a unix stamp.", example: "", icon: ICON_PATHS.clock },
  { id: "ip", method: "GET", cap: "Data", title: "Client IP", use: "See the IP address the service observes for your call.", example: "", icon: ICON_PATHS.pin },
  { id: "wordcount", method: "POST", cap: "Data", title: "Word Count", use: "Count words, characters, and lines in a block of text.", example: '{\n  "text": "Hello World"\n}', icon: ICON_PATHS.text },
  // Tools
  { id: "uuid", method: "GET", cap: "Tools", title: "UUID Generator", use: "Get a fresh random UUID v4 per call.", example: "", icon: ICON_PATHS.key },
  { id: "random", method: "GET", cap: "Tools", title: "Random Bytes", use: "Pull 16 random bytes as hex, plus a derived integer.", example: "", icon: ICON_PATHS.dice },
  { id: "echo", method: "POST", cap: "Tools", title: "Echo", use: "Mirror a JSON message back — handy for wiring up payment flow.", example: '{\n  "message": "hello"\n}', icon: ICON_PATHS.echo },
  { id: "base64", method: "POST", cap: "Tools", title: "Base64 Codec", use: "Encode text to Base64, or decode Base64 back to text.", example: '{\n  "text": "hello",\n  "action": "encode"\n}', icon: ICON_PATHS.code },
  { id: "slug", method: "POST", cap: "Tools", title: "Slugify", use: "Turn any text into a clean URL-safe slug.", example: '{\n  "text": "Hello World"\n}', icon: ICON_PATHS.link },
  // Crypto
  { id: "network", method: "GET", cap: "Crypto", title: "Network Info", use: "Base chain id, USDC contract, and payment metadata.", example: "", icon: ICON_PATHS.chain },
  { id: "hash", method: "POST", cap: "Crypto", title: "SHA-256 Hash", use: "SHA-256 digest of a string, hex-encoded.", example: '{\n  "text": "hello"\n}', icon: ICON_PATHS.hash },
  { id: "keccak", method: "POST", cap: "Crypto", title: "Keccak-256 Hash", use: "Ethereum-style Keccak-256 digest of a string.", example: '{\n  "text": "hello"\n}', icon: ICON_PATHS.block },
  // Payment
  { id: "payment", method: "GET", cap: "Payment", title: "Payment Receipt", use: "Receipt for the payment that unlocked this call.", example: "", icon: ICON_PATHS.receipt },
  { id: "quote", method: "GET", cap: "Payment", title: "Payment Quote", use: "Exact price, asset, and merchant wallet before you pay.", example: "", icon: ICON_PATHS.doc },
  // AI
  { id: "summarize", method: "POST", cap: "AI", title: "AI Summarize", use: "Condense a long passage into a short summary.", example: '{\n  "text": "Text that should be summarized."\n}', icon: ICON_PATHS.doc },
  { id: "rewrite", method: "POST", cap: "AI", title: "AI Rewrite", use: "Paraphrase text while keeping its meaning.", example: '{\n  "text": "Make this text sound better."\n}', icon: ICON_PATHS.pen },
  { id: "sentiment", method: "POST", cap: "AI", title: "AI Sentiment", use: "Score text as positive, neutral, or negative.", example: '{\n  "text": "This product is great."\n}', icon: ICON_PATHS.smile },
  { id: "keywords", method: "POST", cap: "AI", title: "AI Keywords", use: "Extract the top keywords from a passage.", example: '{\n  "text": "AI payments on Base with USDC."\n}', icon: ICON_PATHS.keys },
  { id: "classify", method: "POST", cap: "AI", title: "AI Classify", use: "Bucket text into a topic category with confidence.", example: '{\n  "text": "Pay the invoice with USDC."\n}', icon: ICON_PATHS.tag },
  { id: "outline", method: "POST", cap: "AI", title: "AI Outline", use: "Turn a passage into a structured outline.", example: '{\n  "text": "First point. Second point."\n}', icon: ICON_PATHS.tree },
];

// 80% of api-xpay.com's prices (see docs/PRICING.md). Overridden at runtime
// by the live pricesUsdc map from the server.
const DEFAULT_PRICES: Record<string, string> = {
  ping: "0.004", status: "0.004", time: "0.004", uuid: "0.004", random: "0.004",
  ip: "0.004", network: "0.004", echo: "0.004", hash: "0.004", keccak: "0.004",
  base64: "0.004", slug: "0.004", wordcount: "0.004", payment: "0.004", quote: "0.004",
  summarize: "0.008", rewrite: "8", sentiment: "8", keywords: "8", classify: "16", outline: "16",
};

const AGENT_CMD = "curl https://aiutilities.combify.app/llms.txt";

function decodeTerms(header: string | null): string {
  if (!header) return "no PAYMENT-REQUIRED header";
  try {
    const decoded = JSON.parse(atob(header.trim())) as {
      accepts?: Array<{ amount?: string; asset?: string; network?: string; payTo?: string }>;
    };
    const a = decoded.accepts?.[0];
    if (!a) return "no payment terms offered";
    const usdc =
      a.amount !== undefined
        ? `${(Number(a.amount) / 1_000_000).toFixed(6).replace(/0+$/, "").replace(/\.$/, ".0")} USDC`
        : "unknown amount";
    return `price: ${usdc} (${a.amount} atomic)\nnetwork: ${a.network ?? "unknown"}\nasset: ${a.asset ?? "unknown"}\npayTo: ${a.payTo ?? "unknown"}`;
  } catch {
    return header.slice(0, 500);
  }
}

function useTheme() {
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    // Light is the default theme; only a saved explicit choice can start dark.
    return window.localStorage.getItem("theme") === "dark";
  });
  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
    window.localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  // Circular reveal from the toggle button using the View Transitions API.
  // Falls back to the smooth body color transition when unsupported.
  const toggle = (e?: { currentTarget: EventTarget | null }) => {
    const next = !dark;
    const root = document.documentElement;
    const vt = (document as unknown as { startViewTransition?: (cb: () => void) => Promise<void> }).startViewTransition;
    if (typeof vt !== "function" || typeof root.animate !== "function") {
      setDark(next);
      return;
    }
    const btn = e?.currentTarget as HTMLElement | null;
    const rect = btn?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth - 40;
    const y = rect ? rect.top + rect.height / 2 : 32;
    root.style.setProperty("--tx", `${x}px`);
    root.style.setProperty("--ty", `${y}px`);
    root.classList.add("theme-anim");
    vt.call(document, () => {
      setDark(next);
    }).finally(() => {
      root.classList.remove("theme-anim");
    });
  };

  return { dark, toggle };
}

const rd = (seconds: number) =>
  ({ "--rd": `${Number(seconds.toFixed(2))}s` }) as unknown as React.CSSProperties;

function useReveal<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { el.classList.add("revealed"); io.disconnect(); } }),
      { rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

function Reveal({ children, className = "section", id }: { children: React.ReactNode; className?: string; id?: string }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal ${className}`} id={id}>
      {children}
    </div>
  );
}

function BinStrip({ words, seed, reverse }: { words: string[]; seed: number; reverse?: boolean }) {
  const chunks = Array.from({ length: 6 }, (_, i) => {
    if (i % 3 === 1 && words.length) return words[(i * 7 + seed) % words.length];
    let bit = (seed * (i + 3)) % 2;
    let line = "";
    for (let j = 0; j < 20 + ((seed * (i + 5)) % 22); j++) {
      line += bit;
      bit = ((bit * 7 + i + j + seed) % 97) % 2;
    }
    return line;
  });
  const half = (
    <>
      {chunks.map((line, i) => (
        <div key={i} className={line.length < 14 ? "bin-line" : "bin-line bin-word"}>
          {line}
        </div>
      ))}
    </>
  );
  return (
    <div
      className={reverse ? "bin-strip bin-strip--rev" : "bin-strip"}
      style={{ "--dur": `${95 + (seed % 45)}s`, animationDelay: `-${seed % 60}s` } as React.CSSProperties}
    >
      {[0, 1, 2, 3].map((c) => (
        <div key={c} className="bin-flow">
          {half}
        </div>
      ))}
    </div>
  );
}

function BinColumn({ side, words }: { side: "left" | "right"; words: string[] }) {
  const seeds = side === "left" ? [7, 11, 15] : [23, 31, 37];
  return (
    <div className={`bincol bincol--${side}`} aria-hidden="true">
      {seeds.map((s) => (
        <BinStrip key={s} words={words} seed={s} reverse={side === "right"} />
      ))}
    </div>
  );
}

function CliPill({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable
    }
  }, [cmd]);
  return (
    <div className="pill-wrap">
      <div className="pill-label">Give this to your agent</div>
      <div className="cta-cli">
        <span className="cta-cli-pr">$</span>
        <span className="cta-cli-cmd">{cmd}</span>
        <button className={`cta-cli-copy ${copied ? "copied" : ""}`} onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="pill-caption">and let it take it from there.</div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`faq-item ${open ? "open" : ""}`}>
      <button className="faq-q" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {q}
        <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div className="faq-a">
        <div><p>{a}</p></div>
      </div>
    </div>
  );
}

const FAQ = [
  {
    q: "Do I need an account or an API key?",
    a: <>No. There is no sign-up, no dashboard, and no key to leak. An agent calls a paid route, gets a 402 with the exact price, and pays it with any x402 buyer.</>,
  },
  {
    q: "Is there a subscription or a monthly minimum?",
    a: <>No subscription, no seats, no minimum, no plan to pick. You pay only for the calls you actually make, priced per request.</>,
  },
  {
    q: "What happens if a call fails?",
    a: <>Paid calls settle only on success. A 4xx or 5xx response — including an AI provider failure — is never charged.</>,
  },
  {
    q: "How does my agent pay?",
    a: <>Unpaid requests return <code>402 Payment Required</code> with the price in the <code>PAYMENT-REQUIRED</code> header. Any x402 buyer signs USDC on Base and retries with a <code>PAYMENT-SIGNATURE</code> header.</>,
  },
  {
    q: "Can I retry without paying twice?",
    a: <>Yes. Send a unique <code>Idempotency-Key</code> with your request and reuse it on retries. A replay returns the settled result with no second charge.</>,
  },
  {
    q: "What are the cheapest routes?",
    a: <>The 15 utility, data, tools, crypto, and payment routes are $0.004 each. AI summarize is $0.008; rewrite, sentiment, and keywords are $8; classify and outline are $16.</>,
  },
];

export default function App() {
  const { dark, toggle } = useTheme();
  const [endpoint, setEndpoint] = useState("ping");
  const [body, setBody] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>(DEFAULT_PRICES);
  const [out, setOut] = useState(
    "Pick a route, edit the body, send. An unpaid call returns 402 with the exact price. No wallet needed to see the quote."
  );
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const heroRef = useReveal<HTMLDivElement>();

  useEffect(() => {
    (async () => {
      try {
        const info = await fetch("/", { headers: { Accept: "application/json" } }).then((r) => r.json());
        const p = (info as { pricesUsdc?: Record<string, string> }).pricesUsdc;
        if (p) setPrices((prev) => ({ ...prev, ...p }));
      } catch {
        // keep defaults
      }
    })();
  }, []);

  const current = ENDPOINTS.find((e) => e.id === endpoint) ?? ENDPOINTS[0];

  const pick = useCallback((id: string) => {
    setEndpoint(id);
    const ep = ENDPOINTS.find((e) => e.id === id);
    setBody(ep?.example ?? "");
  }, []);

  const send = useCallback(async () => {
    setBusy(true);
    setOut("requesting...");
    try {
      const ep = ENDPOINTS.find((e) => e.id === endpoint);
      const isGet = ep?.method === "GET";
      const res = await fetch(`/x402/${endpoint}`, {
        method: ep?.method ?? "POST",
        ...(isGet
          ? {}
          : { headers: { "Content-Type": "application/json" }, body }),
      });
      const terms = decodeTerms(res.headers.get("payment-required") ?? res.headers.get("PAYMENT-REQUIRED"));
      if (res.status === 402) {
        setOut(`HTTP 402 Payment Required\n\n${terms}\n\nSign these terms with any x402 buyer and retry with a PAYMENT-SIGNATURE header.`);
        return;
      }
      const text = await res.text();
      setOut(`HTTP ${res.status}\n\n${text.slice(0, 3000)}`);
    } catch (e) {
      setOut(`request failed: ${String(e).slice(0, 500)}`);
    } finally {
      setBusy(false);
    }
  }, [endpoint, body]);

  return (
    <>
      <div className="bg-field" aria-hidden="true" />
      <header className="site-header">
        <div className="wrap">
          <a className="brand" href="https://combify.app">
            <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
              <rect x="2" y="2" width="60" height="60" rx="14" fill="#c6f135" />
              <path d="M 41.6 20.5 A 15 15 0 0 0 18.3 26" fill="none" stroke="#0b0d00" strokeWidth="9" strokeLinecap="round" />
              <path d="M 18.3 38 A 15 15 0 0 0 41.6 43.5" fill="none" stroke="#0b0d00" strokeWidth="9" strokeLinecap="round" />
            </svg>
            Combify <small>AI Utilities</small>
          </a>
          <nav className="nav">
            <a href="#pricing">Pricing</a>
            <a href="#endpoints">Endpoints</a>
            <a href="#how">How it works</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="nav-spacer" />
          <button
            className="icon-btn"
            onClick={toggle}
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            title={dark ? "Light theme" : "Dark theme"}
          >
            <svg className="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
            <svg className="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          </button>
          <a className="btn btn-primary btn-sm" href="#playground">
            Try it
          </a>
        </div>
      </header>

      <main>
        <div className="hero-zone">
          <BinColumn side="left" words={["ping", "hash", "slug", "sentiment", "uuid"]} />
          <BinColumn side="right" words={["usdc", "base", "x402", "keccak", "outline"]} />
          <section className="hero reveal" ref={heroRef}>
            <div className="hero-inner">
              <div className="eyebrow" data-rd style={rd(0)}>
                <span className="dot" aria-hidden="true" />
                <span>Live &middot; 21 endpoints &middot; Base USDC</span>
              </div>
              <h1 data-rd style={rd(0.08)}>
                Every small API call, <span>paid per request.</span>
              </h1>
              <p className="hero-take" data-rd style={rd(0.16)}>
                Twenty-one utility, data, tools, crypto, payment, and AI endpoints behind one paywall.
                No accounts, no API keys, <strong>no subscription</strong>. Your agent pays in USDC on Base,
                per call, and only when a call succeeds.
              </p>

              <CliPill cmd={AGENT_CMD} />

              <div className="cta-row" data-rd style={rd(0.32)}>
                <a className="btn btn-primary btn-lg" href="#playground">
                  Try it live
                </a>
                <a className="btn btn-outline btn-lg" href="#pricing">
                  See pricing
                </a>
              </div>
            </div>
          </section>
        </div>

        <Reveal className="section section--first">
          <div className="stats">
            <div className="stat" data-rd style={rd(0)}>
              <div className="stat-num">No subscriptions</div>
              <div className="stat-lbl">No seats, no plan to pick, no monthly minimum. You are never billed for sitting still.</div>
            </div>
            <div className="stat" data-rd style={rd(0.08)}>
              <div className="stat-num">
                From <span className="stat-accent">$0.004</span>
              </div>
              <div className="stat-lbl">One flat price per call, set on the route. You pay only for what you actually use.</div>
            </div>
            <div className="stat" data-rd style={rd(0.16)}>
              <div className="stat-num">Settle on success</div>
              <div className="stat-lbl">A failed call is never charged. Payment settles only after the route returns a result.</div>
            </div>
          </div>
        </Reveal>

        <Reveal id="endpoints" className="section">
          <div className="sec-head">
            <div>
              <div className="sec-tag">Endpoints</div>
              <h2 className="sec-title">
                One paywall. <span>Twenty-one ways</span> to use it.
              </h2>
            </div>
            <p className="sec-blurb">
              Six categories: utility, data, tools, crypto, payment, and AI. Every route is a single
              request with the same 402 flow and the same USDC-on-Base settlement.
            </p>
          </div>
          <div className="cards">
            {ENDPOINTS.map((e, i) => (
              <div className="app-card" key={e.id} data-rd style={rd(0.03 * (i % 8))}>
                <div className="tico">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {e.icon}
                  </svg>
                </div>
                <div className="cap">{e.cap}</div>
                <h3>{e.title}</h3>
                <div className="route">{e.method} /x402/{e.id}</div>
                <p>{e.use}</p>
                <div className="foot">
                  <span className="model">{e.method === "GET" ? "no body" : "JSON body"}</span>
                  <span className="price-tag">${prices[e.id] ?? "?"}</span>
                </div>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal id="how" className="section">
          <h2 className="hiw-title">
            Unpaid calls never touch <span>the work.</span>
          </h2>
          <div className="hiw-flow">
            <div className="hiw-node" data-rd style={rd(0)}>
              <div className="hiw-icon hiw-icon-glyph">
                <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L4.09 12.35a1 1 0 0 0 .75 1.65H11l-1 7.71a.5.5 0 0 0 .88.36l8.03-9.72a1 1 0 0 0-.75-1.65H13l1-5.7a.5.5 0 0 0-.88-.36z" />
                </svg>
              </div>
              <h3 className="hiw-node-title">Call it unpaid</h3>
              <div className="hiw-chip">402 + PAYMENT-REQUIRED</div>
              <p className="hiw-hint">Call any /x402 route without payment. The server answers 402 with the exact price for that route, no guessing.</p>
            </div>
            <div className="hiw-link" aria-hidden="true" />
            <div className="hiw-node" data-rd style={rd(0.1)}>
              <div className="hiw-icon hiw-icon-glyph">
                <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
              </div>
              <h3 className="hiw-node-title">Sign and retry</h3>
              <div className="hiw-chip">PAYMENT-SIGNATURE</div>
              <p className="hiw-hint">Any x402 buyer signs the USDC amount on Base and resends the request with the payment attached.</p>
            </div>
            <div className="hiw-link" aria-hidden="true" />
            <div className="hiw-node" data-rd style={rd(0.2)}>
              <div className="hiw-icon hiw-icon-glyph">
                <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2L11 13" />
                  <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </div>
              <h3 className="hiw-node-title">Get the result</h3>
              <div className="hiw-chip">200 + PAYMENT-RESPONSE</div>
              <p className="hiw-hint">The facilitator verifies, the route runs, and settlement settles only on success. Failures cost nothing.</p>
            </div>
          </div>
        </Reveal>

        <Reveal id="pricing" className="section">
          <div className="sec-head">
            <div>
              <div className="sec-tag">Pricing</div>
              <h2 className="sec-title">
                Flat per call. <span>No plan to pick.</span>
              </h2>
            </div>
            <p className="sec-blurb">
              Fixed price on every route, in USDC on Base. Prices below are read live from the server when available.
            </p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Use</th>
                </tr>
              </thead>
              <tbody>
                {ENDPOINTS.map((e) => (
                  <tr key={e.id}>
                    <td className="mono">
                      {e.method} /x402/{e.id} <span className="badge-paid">PAID</span>
                    </td>
                    <td className="mono">{e.cap}</td>
                    <td>
                      <span className="price-tag">${prices[e.id] ?? "?"}</span>
                    </td>
                    <td className="muted">{e.use}</td>
                  </tr>
                ))}
                <tr>
                  <td className="mono">
                    GET /, /health, /info, /llms.txt, /x402, /openapi.json <span className="badge-free">FREE</span>
                  </td>
                  <td className="mono">-</td>
                  <td className="mono">$0</td>
                  <td className="muted">descriptor, liveness, agent guide, manifest, and OpenAPI spec</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Reveal>

        <Reveal id="playground" className="section">
          <div className="sec-head">
            <div>
              <div className="sec-tag">Live tester</div>
              <h2 className="sec-title">
                See the <span>402</span> before you pay.
              </h2>
            </div>
            <p className="sec-blurb">
              Sends your request unpaid and decodes the exact price from the response. No wallet and no key needed.
            </p>
          </div>
          <div className="play">
            <div className="row">
              {ENDPOINTS.map((e) => (
                <button key={e.id} type="button" className={`ep-chip ${endpoint === e.id ? "on" : ""}`} onClick={() => pick(e.id)} disabled={busy}>
                  {e.method === "GET" ? "" : "POST "}/x402/{e.id}
                </button>
              ))}
            </div>
            <div className="body-row">
              {current.method === "GET" ? (
                <div className="play-get-note">
                  GET /x402/{current.id} takes no body — hit Send to see the 402 terms.
                </div>
              ) : (
                <textarea value={body} onChange={(ev) => setBody(ev.target.value)} spellCheck={false} />
              )}
              <button className="send" onClick={send} disabled={busy}>
                {busy ? "..." : "Send unpaid"}
              </button>
            </div>
            <pre>{out}</pre>
          </div>
        </Reveal>

        <Reveal className="section">
          <div className="sec-head">
            <div>
              <div className="sec-tag">Integrate</div>
              <h2 className="sec-title">Two commands.</h2>
            </div>
            <p className="sec-blurb">One to read the price, one to pay it and get the result.</p>
          </div>
          <div className="code">
            <span className="c"># unpaid returns 402, read the exact price from the header</span>
            {"\n"}
            curl -i https://aiutilities.combify.app/x402/ping
            {"\n\n"}
            <span className="c"># HTTP/1.1 402 Payment Required</span>
            {"\n"}
            <span className="c">{`# PAYMENT-REQUIRED: base64 JSON with accepts[].amount (e.g. "4000")`}</span>
            {"\n\n"}
            <span className="c"># pay and retry with any x402 buyer (ping is $0.004 = 4000 atomic)</span>
            {"\n"}
            npx awal@2.12.1 x402 pay /x402/ping --max-amount 4000
            {"\n\n"}
            <span className="c"># AI classify is $16 = 16000000 atomic</span>
            {"\n"}
            npx awal@2.12.1 x402 pay /x402/classify -X POST \
            {"\n  "}-d {'{"'}text":"Pay the invoice with USDC."{'}'} --max-amount 16000000
          </div>
        </Reveal>

        <Reveal id="faq" className="section">
          <div className="sec-head sec-head--centered">
            <div>
              <div className="sec-tag">FAQ</div>
              <h2 className="sec-title">Common questions.</h2>
            </div>
          </div>
          <div className="faq">
            {FAQ.map((f, i) => (
              <div key={i} data-rd style={rd(0.05 * i)}>
                <FaqItem q={f.q} a={f.a} />
              </div>
            ))}
          </div>
        </Reveal>
      </main>

      <footer className="ftr">
        <div className="ftr-top">
          <div className="ftr-brand-col">
            <a className="brand brand--ftr" href="https://combify.app">
              <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
                <rect x="2" y="2" width="60" height="60" rx="14" fill="#c6f135" />
                <path d="M 41.6 20.5 A 15 15 0 0 0 18.3 26" fill="none" stroke="#0b0d00" strokeWidth="9" strokeLinecap="round" />
                <path d="M 18.3 38 A 15 15 0 0 0 41.6 43.5" fill="none" stroke="#0b0d00" strokeWidth="9" strokeLinecap="round" />
              </svg>
              Combify <small>AI Utilities</small>
            </a>
            <p className="ftr-desc">Pay-per-request utility and AI APIs on Base. No accounts, no API keys, no subscription. Your agent pays only for calls that succeed.</p>
            <p className="ftr-copy">© 2026 Combify · priced in USDC, settled on Base</p>
          </div>
          <div className="ftr-cols">
            <div className="ftr-col">
              <h4>Apps</h4>
              <a className="ftr-link" href="https://combify.app">combify.app</a>
              <a className="ftr-link" href="https://search.combify.app">search</a>
              <a className="ftr-link" href="https://scrape.combify.app">scrape</a>
              <a className="ftr-link" href="https://compute.combify.app">compute</a>
            </div>
            <div className="ftr-col">
              <h4>Agents</h4>
              <a className="ftr-link" href="/llms.txt">llms.txt</a>
              <a className="ftr-link" href="/x402">/x402 manifest</a>
              <a className="ftr-link" href="/openapi.json">openapi.json</a>
              <a className="ftr-link" href="/health">health</a>
            </div>
          </div>
        </div>
        <div className="ftr-giant" aria-hidden="true">
          aiutilities
        </div>
      </footer>
    </>
  );
}

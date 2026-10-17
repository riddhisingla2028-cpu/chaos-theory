# Chaos Theory: launch plan, audit and setup

Status as of 16 Oct 2026. Nothing here is live yet: the game is **not deployed**, has **no custom domain**, has **not sold anything**, and has **no analytics data**. This file says exactly what exists, what is blocked, and the steps to go live.

## 1. Audit (verified in code and by running it)

| # | Feature | Status | Evidence / notes |
|---|---|---|---|
| 1 | 10 campaign arenas | IMPLEMENTED | 10 distinct geometries in `src/game/arenas.ts`; arena tests (never stranded, always room); autopilot simulations; every level started, played and restarted in a browser (11/11). |
| 2 | Mobile touch and responsive layout | IMPLEMENTED (emulated) | Touch joystick, phone and landscape layouts; 9 screens checked at 360×640, 390×844, 768×1024, 1024×768 and 1440×900 with no overflow and ≥40px targets (86/86). **Not yet tried on a physical phone.** |
| 3 | XP, levels, challenges, achievements, cosmetic unlocks | IMPLEMENTED | Unit-tested; browser-tested (rewards panel, profile, trails). |
| 4 | Chaos Coins | NOT IMPLEMENTED | No coin code exists. Recommendation below: do not add before the deadline. |
| 5 | Lives, regeneration, daily bonus lives, extra-life rewards | NOT IMPLEMENTED | Retries are unlimited and free. Rewarded ads exist only as a disabled interface that can never grant anything without a real provider confirming a view. |
| 6 | Multiplayer (rooms, reconnection, 3 modes) | IMPLEMENTED | Two real browsers over the internet: create, join by link, ready, start, movement, hazards, reconnect, results, rematch, host leaving (18/18), plus a production build check (5/5). Mode rules are unit-tested. No TURN relay, so some strict networks cannot connect. Boss Co-op: NOT IMPLEMENTED. |
| 7 | Chaos+ purchase | IMPLEMENTED, BLOCKED on your Gumroad account | Server verification tested against the **live Gumroad API** (unknown keys refused) and in Cloudflare's runtime; the success and refund paths were tested with **simulated** Gumroad answers because no real purchase exists. Off until configured: the page says "Coming soon". |
| 8 | Advertising | PLACEHOLDERS ONLY | "Your brand here" panels on five menu screens (launcher, level select, level results, Endless results, profile); none on the game screen. No ad network, no ad script, no advertisers, no revenue. |
| 9 | Supabase accounts and cloud saves | PARTIALLY IMPLEMENTED, BLOCKED on credentials | Code, schema with row-level security, tests against a simulated Supabase. Never run against a real project. |
| 10 | Score sharing, local leaderboard, save integrity | IMPLEMENTED | Share card tested (PNG produced); "This week" local ranking; versioned saves with migration tests. Global leaderboard: NOT IMPLEMENTED (needs Supabase). |
| 11 | Analytics | IMPLEMENTED, OFF until configured | Umami, cookieless, no personal data; event names only. |
| 12 | Deployment and custom domain | NOT DONE | Needs your approval and accounts (section 4). |

## 2. Monetisation decision

**Chosen route: a one-time "Chaos+" supporter purchase sold through Gumroad, verified by a server function.** It is the smallest reliable path to a genuine paid transaction from India to international buyers (including the US).

Why Gumroad (checked on 16 Oct 2026):
- **Merchant of record:** Gumroad takes the payment, collects and pays sales tax, VAT and GST, issues receipts, and handles refunds ([pricing page](https://gumroad.com/pricing): "Since January 1, 2025, Gumroad handles ALL your tax obligations").
- **Fees:** 10% + $0.50 per direct sale; 30% for sales found through Gumroad Discover ([pricing](https://gumroad.com/pricing)). On a US$3 sale you keep about US$2.20.
- **India payouts:** Gumroad's own open-source code has Indian bank accounts (IFSC, paid in INR) (`app/models/indian_bank_account.rb` in [antiwork/gumroad](https://github.com/antiwork/gumroad)). The same code sets a **default minimum payout of $100**, so the first sales will appear in your dashboard and in the buyer's receipt straight away, but money reaches your bank only after you pass the minimum. Gumroad's help pages would not load for checking, so **confirm India payouts in your Gumroad payout settings before you rely on them.**
- **License keys:** Gumroad emails each buyer a unique key. Its verify API needs **no secret key**, only the product id and the key, and reports refunds and chargebacks (verified in Gumroad's source and by calling the live API).
- **Alternatives considered:** Razorpay needs separate approval for international cards, plus website policy pages and documents, which could take days ([Razorpay](https://razorpay.com/learn/breaking-down-the-requirements-for-accepting-international-payments-through-razorpay/)). Lemon Squeezy's eligibility for Indian sellers could not be confirmed from its docs ([supported countries](https://docs.lemonsqueezy.com/help/getting-started/supported-countries)). Stripe is invite-only for new Indian accounts according to third-party reports.

**How a purchase works (and why it is safe):**
1. The player opens Chaos+ and taps **Get Chaos+**, which opens your Gumroad page in a new tab. Cancelled or failed payments simply produce no key.
2. Gumroad emails a license key.
3. The player pastes it in the game. The browser sends it to **our server** (`/api/verify-license`, a Cloudflare Pages Function), which asks Gumroad. Only a "valid, not refunded, not charged back" answer unlocks Chaos+.
4. On every later visit the key is re-checked with the server, so a page refresh is safe, and refunds and chargebacks switch Chaos+ off. A key typed into browser storage by hand unlocks nothing (tested). Each key works on up to 5 devices.
5. There are no webhooks, so there is no duplicate-webhook problem. No secret key exists anywhere.

**What Chaos+ gives (all enforced by the verified purchase):** a supporter badge (profile, launcher, share cards); the Halo trail and Supernova victory effect, which cannot be earned by playing; the Chaos+ collection (2 skins, 2 themes) and 2 bonus trials; and no ads if ads are ever added. Once purchases are live, the free preview of the collection disappears, so nothing sold is free elsewhere. All levels, Endless, multiplayer, challenges and XP stay free.

**Suggested price:** US$3 (enable "let customers pay more" on Gumroad). That is low enough for an impulse supporter purchase by friends and classmates; the price shown in the game must match Gumroad's.

**Not recommended before the deadline:**
- **Chaos Coins:** a currency adds balance, economy and anti-duplication work, and earns nothing by itself. Earned cosmetics already exist (XP levels).
- **Lives and extra-life purchases:** limiting retries would make a free game worse, and selling lives is the kind of pressure the brief says to avoid. Rewarded ads cannot be added honestly without a real ad provider.
- **Ads:** an ad network needs approval and traffic; at launch volumes the revenue would be close to zero. The placeholders remain ready.
- **Sponsorship (later, only with a real sponsor):** a "sponsored weekly challenge" (sponsor name on the challenge card and a matching cosmetic) would fit the existing challenge system. No sponsor exists and none is implied anywhere in the game.

## 3. Your setup steps (in order)

### A. Gumroad product (about 15 minutes, free)
1. Create an account at gumroad.com and complete payout settings (bank account in India), identity verification and tax details. Confirm that India bank payouts are offered.
2. New product → type "Digital product". Name: "Chaos+ (Chaos Theory supporter pack)". Price US$3. Description: list the benefits in section 2 and say it is a code to unlock in the game, with nothing to download.
3. In the product's content settings turn on **Generate a unique license key per sale**. Copy the **product ID** shown there.
4. Publish. Copy the product URL (looks like `https://yourname.gumroad.com/l/chaosplus`).

### B. Cloudflare Pages hosting (free; allows custom domains and server functions)
Vercel's free Hobby plan is non-commercial only ([Vercel fair use](https://vercel.com/docs/limits/fair-use-guidelines)), and selling Chaos+ is commercial. Cloudflare Pages' free plan runs the verify function (100,000 function requests a day: [Cloudflare docs](https://developers.cloudflare.com/pages/functions/pricing/)). **Read Cloudflare's terms yourself to confirm commercial use on the free plan.**
1. Create a Cloudflare account → Workers & Pages → Create → Pages → connect the GitHub repo.
2. Build command `npm run build`, output directory `dist`. The `functions/` folder is picked up automatically.
3. Environment variables (Settings → Variables):
   - `VITE_CHAOSPLUS_CHECKOUT_URL` = your Gumroad product URL
   - `VITE_CHAOSPLUS_PRICE` = `US$3` (must match Gumroad)
   - `VITE_SUPPORT_EMAIL` = an inbox you will answer
   - `GUMROAD_PRODUCT_ID` = the product ID (server-only; never prefix with VITE_)
   - Optional: `VITE_UMAMI_WEBSITE_ID` (analytics), `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (accounts)
4. Deploy, then open the site's Chaos+ page and check that it shows the price and the Gumroad button.

### C. Custom domain (paid, your decision)
Buy a domain (roughly ₹100–1,200 a year depending on the ending) from any registrar, or through Cloudflare Registrar at cost. In Pages → Custom domains, add it and follow the DNS steps. HTTPS is automatic.

### D. First real purchase (proof for the submission)
Ask a real person (a friend or classmate who genuinely wants it, paying with their own card) to buy Chaos+. Do not buy it yourself, since a self-purchase is not a customer. Keep: the Gumroad sale in your dashboard (screenshot), and the unlocked Chaos+ in their game. If someone asks for a refund, give it.

### E. Analytics (optional, free)
Create a free Umami Cloud account, add the website, copy its website ID into `VITE_UMAMI_WEBSITE_ID`, and redeploy. Events: `play_click`, `game_start`, `game_complete`, `mp_room_created`, `mp_room_joined`, `mp_match_started`, `chaosplus_view`, `checkout_start`, `purchase_verified`, `share_score`. Visitors are counted as page views. The Gumroad dashboard is the source of truth for sales.

## 4. Launch plan (honest, no spam)

**Who to reach first:** friends and classmates (multiplayer needs 2–6 people, so every player can bring more); your college's gaming and tech clubs (ask the admins first); web-game communities that allow self-promotion, following each one's rules; and an itch.io page for the game (free web-game listing), linking to the site.

**What to post:** a 20–30 second screen recording of a 3-player Orb Race, plus one line ("Free browser game, no sign-up. Make a room and send the link"). The invite link and share cards are the built-in ways for players to bring others.

**Never:** fake reviews, buying your own product, posting the same message across many groups, or messaging strangers.

**Experiments to run in the first week** (measure with the analytics events and Gumroad):
1. *Does multiplayer bring players?* Rooms created, players per room, and how many joiners go on to start a solo game.
2. *Where does the purchase funnel leak?* Chaos+ page views → checkout starts → verified purchases. If views are high but checkouts are low, change the copy or the price; if checkouts are high but purchases are low, look at Gumroad's checkout (currency, cards).
3. *Do players come back?* Daily challenge completions over consecutive days. Try announcing the daily challenge in the group chat at the same time each day.
4. *Do share cards travel?* Shares compared with new visitors the next day.

## 5. College submission checklist

| Requirement | State | What is left |
|---|---|---|
| Working product on a custom domain | Not done | Steps 3B and 3C (needs your approval and the domain purchase). |
| GitHub repository with read-only tracking | Repo exists; the latest work is on the local branch `upgrade/arenas`, not pushed | Push with your approval. Tell me the college's exact instruction for the "read-only tracking key" (it could mean adding an evaluator as a read-only collaborator, or a deploy key); I have not done anything for it. |
| Product description | Draft below | Review and edit. |
| Genuine payment proof (if required) | None yet | Steps 3A, 3B and 3D. |

### Draft product description

> **Chaos Theory** is a free neon arcade survival game that runs in any browser, on phone or desktop, with no download and no sign-up. You dodge hazards while the rules rewrite themselves every few seconds: controls flip, floors fall away, gravity pulls you sideways.
>
> **Features:** a 10-level campaign where every level has its own arena (a maze, a rotating ring, collapsing floors, islands joined by vanishing bridges) ending in a four-phase boss fight; four Endless modes; private multiplayer rooms for 2–6 players (Co-op Survival, Last Player Standing, Orb Race) joined with a code or invite link; XP, account levels, daily and weekly challenges, achievements and unlockable cosmetics; shareable score cards; and accessibility options (separate sound and music volume, reduced motion, high contrast).
>
> **Chaos+** is an optional one-time supporter purchase (sold through Gumroad) that adds a supporter badge and cosmetic effects. It never affects gameplay, and every level and mode is free.
>
> **Testing:** 204 automated unit tests (game rules, arena geometry, progression, save merging, purchase verification, multiplayer protocol), browser tests at five screen sizes, a two-browser real-network multiplayer test, and production-build checks.
>
> **Access:** open [your domain] in any modern browser and tap to play. To play with friends: Multiplayer → Create room → share the link.

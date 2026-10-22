# Could our racecraft AI be a paper? Assessment

Date: 2026-10-21. Builds on `racing-ai-training.md` (not repeated). Tags: [V] page opened this session, [S] confirmed via search snippet only, [M] memory, unverified.

## Verdict

Publishable as a workshop/short/applied-games paper if the experiment plan (section 4) is done; not a top-venue (Nature/NeurIPS main) contribution. Pieces exist separately in the literature (residual policy over a racing line, ES, league self-play, fault-aware collision penalties); the combination, the pass-cause classification and the very low compute are the defensible contribution. The current evidence (a few Cleveland laps vs one human) is an engineering result, not a scientific one.

## 1. Closest prior work

| # | Work | Venue / year | Relevance | Status |
|---|---|---|---|---|
| 1 | Wurman et al., "Outracing champion Gran Turismo drivers with deep reinforcement learning" (GT Sophy). https://www.nature.com/articles/s41586-021-04357-7 | Nature 602:223-228, 2022 | Passing reward, collision penalty, etiquette, scenario training. Direct comparison target. | [S/M] Nature page redirects to login; bibliographic data from search + memory |
| 2 | Lee, Seno, Tai, Subramanian, Kawamoto, Stone, Wurman, "A Champion-level Vision-based RL Agent for Competitive Racing in Gran Turismo 7". https://arxiv.org/abs/2504.09021 | RA-L 2025 | Sophy successor; collision penalty = -|dv|^2 symmetric (no blame split) per search summary | [V] |
| 3 | Trumpp, Hoornaert, Caccamo, "Residual Policy Learning for Vehicle Control of Autonomous Racing Cars". https://arxiv.org/abs/2302.07035 | IEEE IV 2023 | Same architecture (residual on racing-line follower), solo laps, PPO | [V] |
| 4 | Trumpp, Javanmardi, Nakazato, Tsukada, Caccamo, "RaceMOP: Mapless Online Path Planning for Multi-Agent Autonomous Racing using Residual Policy Learning". https://arxiv.org/abs/2403.07129 | IROS 2024 | Residual + multi-agent overtaking; closest overall. Uses RL, not ES | [V] |
| 5 | Geles, Bauersfeld, Wulfmeier, Scaramuzza, "Superhuman Safe and Agile Racing through Multi-Agent RL". https://arxiv.org/abs/2605.22748 | arXiv 2026 (no venue yet) | League self-play, -50 % collisions; no fault attribution | [V] |
| 6 | Cardamone, Loiacono, Lanzi, "Evolving competitive car controllers for racing games with neuroevolution". NEAT, drive-fast and overtake as separate skills (TORCS). Record: https://re.public.polimi.it/handle/11311/565272 | GECCO 2009 [M for venue; page 403, abstract seen via search] | Neuroevolution + overtaking baseline | [S] |
| 7 | Loiacono, Prete, Lanzi, Cardamone, "Learning to overtake in TORCS using simple reinforcement learning". No URL verified (listed at https://re.public.polimi.it/cris/rp/rp00493) | IEEE CEC 2010 [M] | Overtaking skill via Q-learning | [S] authors/year/title from Polimi listing; venue unverified |
| 8 | Song, Lin, Kaufmann, Duerr, Scaramuzza, "Autonomous Overtaking in Gran Turismo Sport Using Curriculum RL". https://arxiv.org/abs/2103.14666 | ICRA 2021 | Overtaking with curriculum | [V] |
| 9 | Fuchs, Song, Kaufmann, Scaramuzza, Duerr, "Super-Human Performance in Gran Turismo Sport Using Deep RL". https://arxiv.org/abs/2008.07971 | RA-L 2021 (+ICRA 2021) | Solo pace RL | [V] |
| 10 | Thakkar, Samyal, Fridovich-Keil, Xu, Topcu, "Hierarchical Control for Cooperative Teams in Competitive Autonomous Racing". https://arxiv.org/abs/2204.13070 | IEEE T-IV 2024 (per search; arXiv page names no venue) | Rule-compliant racing, game-theoretic planner + MARL; encodes racing rules, closest to "sportsmanship" | [V] arXiv; venue [S] |
| 11 | Werner et al., "Dynamic Multi-Team Racing: Competitive Driving on 1/10-th Scale Vehicles via Learning in Simulation". https://proceedings.mlr.press/v229/werner23a.html | CoRL 2023 (PMLR 229) | Self-play RL, sim-to-real | [V] |
| 12 | Zhang, Hu, Wang, Qin, Su, Xie, "Robust Spatiotemporal Motion Planning for Multi-Agent Autonomous Racing via Topological Gap Identification and Accelerated MPC". https://arxiv.org/abs/2603.09188 | arXiv 2026 | Planning-based overtaking, F1TENTH | [V] |

Methodology references (all [V]):
- Salimans, Ho, Chen, Sidor, Sutskever, "Evolution Strategies as a Scalable Alternative to RL", arXiv:1703.03864, 2017 (https://arxiv.org/abs/1703.03864). No journal/conference venue listed.
- Silver, Allen, Tenenbaum, Kaelbling, "Residual Policy Learning", arXiv:1812.06298, 2018 (https://arxiv.org/abs/1812.06298).
- Johannink et al. (incl. Levine), "Residual Reinforcement Learning for Robot Control", arXiv:1812.03201, 2018; ICRA 2019 [M] (https://arxiv.org/abs/1812.03201).
- Chen, Goodfellow, Shlens, "Net2Net: Accelerating Learning via Knowledge Transfer", arXiv:1511.05641, ICLR 2016 [arXiv page lists "ICLR 2016 submission"] (https://arxiv.org/abs/1511.05641).
- Betz, Zheng, Liniger, Rosolia, Karle, Behl, Krovi, Mangharam, "Autonomous Vehicles on the Edge: A Survey on Autonomous Vehicle Racing", IEEE Open J. ITS 3:458-488, 2022, DOI 10.1109/OJITS.2022.3181510 (https://arxiv.org/abs/2202.07008) [S, search confirmed; page not opened].

Not found / not verified: F1TENTH multi-agent racing papers (only the 2026 MPC paper above), Indy Autonomous Challenge papers, and any paper on blame-split collision rewards in racing. A search for sportsmanship / fault-aware / at-fault-collision racing rewards returned none; the GT7 paper is symmetric in the collision term and the multi-drone papers apply collision penalties without attribution. This is an absence of search hits, not proof of absence. Do a proper literature pass (Google Scholar, "racing etiquette", "blame", "responsibility-sensitive safety", "RSS" for driving) before claiming novelty.

Related concept worth citing [M]: Mobileye RSS (Shalev-Shwartz et al., 2017) for formalised fault in driving; credit assignment/counterfactual baselines in MARL (COMA, Foerster et al. AAAI 2018). Not verified this session.

## 2. (a) What is novel, honestly

Not novel:
- Residual policy on a classical racing-line follower (Silver, Johannink, Trumpp, RaceMOP).
- ES for policy search (Salimans); neuroevolution for racing and overtaking (TORCS/SCRC, NEAT).
- League / past-snapshot self-play (Sophy, Geles, CRUISE, Werner).
- Net2Net-style growth (Chen 2016); applying it under ES is a small variation.
- Passing reward plus collision penalty (Sophy). Position-based pass credit is standard.

Plausibly novel (must be shown by ablation, and checked against the literature):
1. Pass-cause classification: pass credit gated by why the position changed (own pace, defender error, other car's crash/yellow). Sophy rewards passes without this gating; reward-hacking by "pass via others' crashes" is a real failure mode and a clean ablation target.
2. Fault-split collision blame (victim 20 %) as a reward term, instead of symmetric dv^2.
3. Combination: bounded residual (lateral offset + pace) over a classic line follower, trained by ES with a league, on one consumer PC. The compute contrast with Sophy (1000+ PS4s, 25 people) is a legitimate selling point only if baselines are matched.
4. Combat-input design (overlap, closing gap, brake-zone distance, inside/outside flags) as an engineered interface: small, but ablatable (v1 vs v2).

Weak points a reviewer will hit: one track/one car class, single physics sim of our own (no external benchmark), human comparison n=1, ES vs RL not compared, no seeds so far, fitness weights hand-tuned, "clean pass" depends on our own classifier (circularity: we optimise and measure the same definition).

## 3. (b) Best framing

Ranked:
1. "Fault-aware, cause-gated overtaking rewards for clean racing AI" (reward design, with ES/residual as the vehicle). Sharpest claim, testable, reviewers in CoG/AIIDE care about game AI behaviour quality. Needs an external, independent measure of cleanliness (human replay rating, or steward-style rule check not used in training).
2. "Low-compute racecraft: residual neuroevolution over a classic racing AI in a consumer-PC budget". Strong for games venues and practitioners; weaker as science unless compared with PPO/SAC residual at equal wall-clock.
3. "Residual neuroevolution over a classic racing AI" alone: too close to Trumpp/RaceMOP with ES swapped in; do not lead with it.

Recommended: framing 1 as the title/claim, framing 2 as the supporting contribution (compute table), framing 3 as the method section.

## 4. (c) Venues and deadlines

Dates are from search/aggregators, not all official pages; re-check before planning.
- EvoStar 2027 / EvoApplications (Mainz, 31 Mar-2 Apr 2027, Springer LNCS): submission deadline 1 Nov 2026 per evostar.org/2027 (https://www.evostar.org/2027/evoapps/) [S]. Too close for a paper with the full plan (10 days); late-breaking abstracts 21 Mar 2027 are feasible for a poster abstract.
- IEEE CoG: 2026 full-paper deadline was 17 Mar 2026 (8 pages, double anonymous; conference Madrid 1-4 Sep 2026) [S]. 2027 call not found; expect a similar March deadline. Best primary target; auxiliary/short track deadline ~mid-May in 2026 pattern.
- GECCO: 2026 cycle was abstract 19 Jan, full paper 26 Jan (8 pages), poster-only 4 pages same day, notification 20 Mar [V from gecco-2027 CfP page, which is inconsistent and appears to show 2026 dates]. 2027 (Krakow, Jul 2027 per one listing) call not yet issued. Expect late-January 2027; relevant tracks: neuroevolution, "Real World Applications", Evolutionary ML; no games track seen. Poster-only 4-page paper is a low-cost option.
- AIIDE 2026: abstract 19 Jun, paper 26 Jun 2026 [S]; next one ~June 2027. Good fit for the behaviour-quality framing.
- FDG: not searched; typically a January deadline [M].
- arXiv: post the preprint as soon as baselines and seeds exist (no deadline); enables citation and community feedback. NeurIPS/ICML workshops on games/agents: deadlines usually Aug-Sep (NeurIPS) and May (ICML) [M]; not searched.

Practical schedule: target GECCO 2027 poster/full (late Jan 2027) or IEEE CoG 2027 (March 2027), with arXiv in between. That gives about 3-4 months for section 5.

## 5. (d) Minimum experiment plan

Setup: fixed car (F4), 3 train tracks + 2-3 held-out tracks (Cleveland is train; add layouts with different corner types and a street circuit), 11-car grids, randomised grid slots, mass/power jitter, mixed opponent set (classic AI at 3 skills, past snapshots).

Baselines:
- B0 classic rule-based AI (min-time line + existing overtake logic).
- B1 pure neural end-to-end policy (same net size, same ES budget, no line).
- B2 residual ES with progress + position fitness only (no racecraft terms).
- B3 residual with symmetric collision penalty and ungated pass credit (Sophy-style).
- B4 (strongly recommended) residual trained with PPO or SAC at equal wall-clock/sim-steps: answers "why ES".
- Optional: reproduce Trumpp-style bounded residual to show the authority bound matters.

Full method = residual + gated pass credit + fault split + defend reward + league + v2 net.

Ablations (remove one at a time from the full method): fault-split off (symmetric blame); victim share 0/20/50 %; clean-pass gating off; league off (fixed opponents); defend weight 0/low/high; net v1 vs v2 (inputs) and v2 with growth vs trained-from-scratch at the same size; spin/incident penalty off.

Metrics (per race, aggregate over >= 100 races per cell):
- Lap time (median, best, std) alone and in traffic; race time.
- Clean passes/race and total passes/race; pass-cause breakdown (own pace vs others' errors); pass-clean ratio.
- Positions defended / lost-and-regained; time spent in battle.
- At-fault contacts per 100 laps, victim contacts, fault-weighted collision score, spins, off-track time, yellow flags caused.
- Independent steward metric not used in training (rule-based post-hoc rating) plus blinded human replay rating (n >= 10 raters, 20 clips per method, pairwise preference).
- Generalisation: all of the above on held-out tracks and held-out opponents (unseen snapshots, unseen skill levels).

Statistics: >= 5 independent training seeds per method (different initial population and race seeds); report median and IQR with bootstrap 95 % CIs; Mann-Whitney U or permutation test with Holm correction across ablations; report effect sizes; show learning curves vs generations and vs wall-clock. Evaluate final models on a held-out seed set, never the training seeds. Check league cycling (cross-play matrix of snapshots).

Compute reporting: generations, pop size, sim-steps and car-seconds per run, wall-clock, hardware (CPU model, cores, RTX 5060), cloud CPU-hours, joules/estimated cost; compare to Sophy's published scale (1000+ PS4s) and to Trumpp's ~1e7 steps. Report real-time factor per core. Cost of B4 at equal budget.

Human comparison: n >= 5 humans (pad and wheel), >= 10 races each vs the final AI and vs B0; compare lap times, contacts, and subjective rating (fairness, human-likeness, difficulty). Currently n=1; report as anecdote only. Get ethics/consent wording and publish anonymised data. Include a human-likeness caution: matching lap time is not evidence of racecraft quality.

Headline experiment: "Cause-gated pass credit and fault-split blame reduce at-fault contacts per 100 laps by X % at equal or better median race time vs ungated symmetric reward, 5 seeds, on held-out tracks, at < N CPU-hours." If X is not significant, fall back to the compute-focused framing 2.

Risks to resolve first: circular metrics (measure cleanliness with an independent classifier), single-simulator realism (state clearly it is a custom sim; release code and config for reproducibility), Cleveland-only overfitting, and licensing/ethics for human data.

## Open verification items

Nature page for Sophy (login redirect), Cardamone GECCO 2009 venue/DOI, Loiacono CEC 2010 venue, Betz page (only search-confirmed), 2027 CoG/GECCO/FDG calls, Mobileye RSS and COMA citations, any prior blame-split racing reward work.

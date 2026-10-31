# Graph Report - tli-tools  (2026-10-31)

## Corpus Check
- 415 files · ~477,207 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 18 file(s) not represented in the graph (top: (none) 4, .jsonl 4, .bat 2)

## Summary
- 5613 nodes · 14926 edges · 201 communities (174 shown, 27 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 1004 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Warden Engine Actions
- Warden Objectives and Cells
- Vorax Archetypes
- Rust Warden Actions
- Rust Gifts and Devour
- Rust Scene Arrows
- Warden Session State
- Rust Beasts and Markers
- Tracker Baseline Prices
- Tracker Profile and Runs
- Vorax Advisor Worker
- Rust Cell Model
- Warden Data Tables
- Rust Window Capture
- Rust Board Reader
- Rust Scoring Tests
- Warden Bench CLI
- Verify Run Scripts
- Rust Text Reader
- Warden Board Reader
- Vorax Settings and Play
- Vorax Web Build
- Warden Scene Arrows
- Vorax TUI Script
- Vorax Card Rendering
- Rust Alpha Blending Mark
- Vorax Replay Scripts
- Arcana Parser
- Warden Instrument Icons
- Tracker App Screen
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168
- Community 169
- Community 170
- Community 171
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 188
- Community 195
- Community 196
- Community 197
- Community 200

## God Nodes (most connected - your core abstractions)
1. `data` - 126 edges
2. `data()` - 114 edges
3. `Session` - 69 edges
4. `load_png()` - 56 edges
5. `Session` - 55 edges
6. `Tracker` - 49 edges
7. `WardenApp` - 47 edges
8. `Rgba` - 47 edges
9. `tone` - 47 edges
10. `Tracker` - 46 edges

## Surprising Connections (you probably didn't know these)
- `Bag/Prices search filter` --semantically_similar_to--> `Loot tracker app README`  [INFERRED] [semantically similar]
  docs/how-to-track-your-loot.md → apps/tracker/README.md
- `TLI Companion prices API` --semantically_similar_to--> `Community price list (TLI Companion)`  [INFERRED] [semantically similar]
  docs/third-party-data.md → README.md
- `Arcana honest limits list` --semantically_similar_to--> `Arcana log carries no board geometry`  [INFERRED] [semantically similar]
  apps/arcana/README.md → docs/explanation-how-it-works.md
- `Level type table (0 hideout, 3 map, 19 contest, 25/27 tiers, 28 prison)` --semantically_similar_to--> `Run detection from level types`  [INFERRED] [semantically similar]
  apps/tracker/README.md → docs/how-to-track-your-loot.md
- `Price precedence (set > exchange > community)` --semantically_similar_to--> `Exchange price learning (tenth of listings)`  [INFERRED] [semantically similar]
  apps/tracker/README.md → docs/how-to-track-your-loot.md

## Import Cycles
- 2-file cycle: `apps/warden/src/reader/instruments.rs -> apps/warden/src/reader/panels.rs -> apps/warden/src/reader/instruments.rs`
- 2-file cycle: `apps/warden/src/solver/mod.rs -> apps/warden/src/solver/values.rs -> apps/warden/src/solver/mod.rs`
- 2-file cycle: `apps/warden/src/solver/chain.rs -> apps/warden/src/solver/mod.rs -> apps/warden/src/solver/chain.rs`
- 2-file cycle: `apps/warden/src/solver/mod.rs -> apps/warden/src/solver/scores.rs -> apps/warden/src/solver/mod.rs`
- 3-file cycle: `apps/warden/ts/src/reader/mod.ts -> apps/warden/ts/src/reader/model.ts -> apps/warden/ts/src/reader/scene.ts -> apps/warden/ts/src/reader/mod.ts`
- 3-file cycle: `apps/warden/ts/src/reader/instruments.ts -> apps/warden/ts/src/reader/panels.ts -> apps/warden/ts/src/reader/mod.ts -> apps/warden/ts/src/reader/instruments.ts`
- 3-file cycle: `apps/warden/ts/src/reader/click.ts -> apps/warden/ts/src/reader/scene.ts -> apps/warden/ts/src/reader/mod.ts -> apps/warden/ts/src/reader/click.ts`
- 3-file cycle: `apps/warden/src/solver/chain.rs -> apps/warden/src/solver/mod.rs -> apps/warden/src/solver/values.rs -> apps/warden/src/solver/chain.rs`
- 3-file cycle: `apps/warden/src/solver/mod.rs -> apps/warden/src/solver/scores.rs -> apps/warden/src/solver/values.rs -> apps/warden/src/solver/mod.rs`
- 3-file cycle: `apps/warden/src/solver/chain.rs -> apps/warden/src/solver/mod.rs -> apps/warden/src/solver/scores.rs -> apps/warden/src/solver/chain.rs`
- 4-file cycle: `apps/warden/ts/src/reader/instruments.ts -> apps/warden/ts/src/reader/panels.ts -> apps/warden/ts/src/reader/ocr.ts -> apps/warden/ts/src/reader/mod.ts -> apps/warden/ts/src/reader/instruments.ts`
- 4-file cycle: `apps/warden/ts/src/reader/instruments.ts -> apps/warden/ts/src/reader/panels.ts -> apps/warden/ts/src/reader/scene.ts -> apps/warden/ts/src/reader/mod.ts -> apps/warden/ts/src/reader/instruments.ts`
- 4-file cycle: `apps/warden/src/solver/chain.rs -> apps/warden/src/solver/mod.rs -> apps/warden/src/solver/scores.rs -> apps/warden/src/solver/values.rs -> apps/warden/src/solver/chain.rs`

## Hyperedges (group relationships)
- **Capture-Read-Solve-Show pipeline used by both minigame helpers** — docs_explanation_how_it_works_pipeline, docs_explanation_how_it_works_silent_capture, readme_vorax_helper, readme_warden, docs_how_to_other_compositors_capture_cmd [EXTRACTED 1.00]
- **Apps and docs that read the same UE_game.log** — readme_ue_game_log, readme_loot_tracker, readme_arcana_tracker, readme_dashboard, apps_tracker_readme, apps_arcana_readme, docs_explanation_how_it_works_minigame_detection [EXTRACTED 1.00]
- **Resumable state.json persistence pattern across trackers** — docs_how_to_track_your_loot_state, docs_how_to_track_your_arcana_state, docs_explanation_how_it_works_streamed_log_reading, apps_tracker_readme, apps_arcana_readme [EXTRACTED 1.00]
- **Game screen reading pipeline (capture, PNG codec, OCR, reader)** — apps_warden_readme_reader, apps_warden_linux_grim_capture, packages_capture_readme_createcapture, packages_png_readme_image, packages_ocr_readme_runtesseract [INFERRED 0.95]
- **UE_game.log line parsing and minigame tracking** — packages_gamelog_readme_minigametracker, packages_gamelog_readme_classifyline, packages_arcana_readme_tracker, packages_arcana_readme_parseline, packages_tracker_readme_logreader, apps_warden_linux_ue_game_log [INFERRED 0.85]
- **OpenTUI-based terminal tools and shared TUI parts** — apps_warden_linux_warden_tui, apps_warden_linux_opentui, packages_tui_readme_tui_shared, packages_tui_readme_startapp [INFERRED 0.85]
- **Optimal-play instrument build ranking** — apps_vorax_optimal_play_incubation_sac, apps_vorax_optimal_play_contracted_claws, apps_vorax_optimal_play_chrysalis_specimen, apps_vorax_optimal_play_aberrant_sprout, apps_vorax_optimal_play_hypertrophic_pituitary, apps_vorax_optimal_play_plague_madonna, apps_vorax_optimal_play_beak_of_the_twice_born [EXTRACTED 1.00]
- **Debug bundle lifecycle: record, review, replay, report** — apps_vorax_debugging_reader_recording, apps_vorax_debugging_debug_bundle, apps_vorax_web_review_page, apps_vorax_debugging_replay_script, apps_vorax_readme_problem_reporting, apps_vorax_worker_setup_r2_reports_bucket [INFERRED 0.85]
- **Board sharing pipeline: analyzer panel → Cloudflare Worker → D1/R2 → odds dataset** — apps_vorax_web_analyze_share_boards_panel, apps_vorax_readme_board_sharing, apps_vorax_worker_setup_board_collector, apps_vorax_worker_setup_d1_boards_db, apps_vorax_web_odds_shared_boards_dataset [INFERRED 0.85]
- **VORAX Overlay Recommendation Flow** — apps_vorax_docs_overlay_card_vorax_helper_overlay, apps_vorax_docs_overlay_card_next_move_recommendation, apps_vorax_docs_overlay_card_deep_check_confidence, apps_vorax_docs_overlay_card_alternatives_list [EXTRACTED 1.00]
- **Tartarus Prison Gameplay Loop (objective, countdown, cell navigation)** — docs_sample_warden_patrol_tartarus_prison_mode, docs_sample_warden_patrol_objective_progress, docs_sample_warden_patrol_riot_countdown, docs_sample_warden_patrol_cell_selection_ui, docs_sample_warden_patrol_speed_up_control [EXTRACTED 1.00]

## Communities (201 total, 27 thin omitted)

### Community 0 - "Warden Engine Actions"
Cohesion: 0.06
Nodes (119): apply(), ChoiceId, choose(), endDay(), fail(), guard(), Need, Ok (+111 more)

### Community 1 - "Warden Objectives and Cells"
Cohesion: 0.07
Nodes (89): isOk(), beastIndex(), ObjectiveKind, sureGain(), Cell, bestMeal(), bite(), chainOdds() (+81 more)

### Community 2 - "Vorax Archetypes"
Cohesion: 0.05
Nodes (56): ARCHETYPE_NAMES, ARCHETYPE_PLURALS, ARCHETYPES, AWAKEN_BONUS, BASE_STATS, createMonster(), isRareOrBoss(), monsterName() (+48 more)

### Community 3 - "Rust Warden Actions"
Cohesion: 0.05
Nodes (53): Action, Chain, Choose, Devour, End, EndChain, Event, Hunt (+45 more)

### Community 4 - "Rust Gifts and Devour"
Cohesion: 0.09
Nodes (57): swap(), do_devour(), apply_gift(), hungry(), interrogate(), interrogation_room_stop(), archenemy(), behind_closed_doors() (+49 more)

### Community 5 - "Rust Scene Arrows"
Cohesion: 0.06
Nodes (64): main(), ARROW, ARROW_MIN, arrow_scores(), beast_at(), beast_class(), beast_feature(), beast_named() (+56 more)

### Community 6 - "Warden Session State"
Cohesion: 0.05
Nodes (57): bitten(), casketMeals(), CellEdit, cellSight(), chainsVaulted(), changed(), consumeTargets(), DaysClock (+49 more)

### Community 7 - "Rust Beasts and Markers"
Cohesion: 0.08
Nodes (49): sure_gain(), clockwise_path(), marker_seen(), beasts(), dist_worth(), door_dist(), seen_door(), worth() (+41 more)

### Community 8 - "Tracker Baseline Prices"
Cohesion: 0.07
Nodes (55): borrowPrices(), Totals, refreshBaseline(), RunRow, ask(), ATTRIBUTION, ATTRIBUTION_URL, BASELINE_FILE (+47 more)

### Community 9 - "Tracker Profile and Runs"
Cohesion: 0.06
Nodes (23): on, timed(), jawed(), Session, Watch, asRgba(), Args, asRgba() (+15 more)

### Community 10 - "Vorax Advisor Worker"
Cohesion: 0.07
Nodes (56): createAdvisor(), Slice, In, ALWAYS_TAKE, HOLY_WATER_RITES, isAlwaysTake(), isXenopanacea(), XENOPANACEA (+48 more)

### Community 11 - "Rust Cell Model"
Cohesion: 0.07
Nodes (64): beast(), EventMark, Action, cardFromKey(), cardIndex(), Gift, giftFromKey(), giftIndex() (+56 more)

### Community 12 - "Warden Data Tables"
Cohesion: 0.07
Nodes (59): ALL_INMATES, asArray(), asBool(), asNumber(), asObject(), asText(), Beast, BEAST_INDEX (+51 more)

### Community 13 - "Rust Window Capture"
Cohesion: 0.04
Nodes (8): BUFFERS, CONSOLE_CLASSES, FORMAT, FRAME_TIMEOUT, GAME_EXE, RETRY, SAMPLE, Stream

### Community 14 - "Rust Board Reader"
Cohesion: 0.05
Nodes (43): beast(), cell_model(), CellModel, Empty, Inmate, Nest, Office, Scouted (+35 more)

### Community 15 - "Rust Scoring Tests"
Cohesion: 0.07
Nodes (52): build_state(), steps_between(), a_rat_nest_due_in_the_run_scores_below_a_plain_door(), a_read_board_gives_the_maiden_no_rise(), a_revealed_legendary_door_outscores_an_unseen_one(), a_tusk_cell_outscores_the_same_cell_unmarked(), an_early_gift_opens_doors_over_raising_one_rare(), an_extra_portion_marker_beats_a_plain_door() (+44 more)

### Community 16 - "Warden Bench CLI"
Cohesion: 0.08
Nodes (57): BenchJob, scope, availableParallelism(), benchGames(), debugFloat(), debugParams(), escapeRegExp(), isPng() (+49 more)

### Community 17 - "Verify Run Scripts"
Cohesion: 0.05
Nodes (35): from, given, reader, reader2, run, to, tracker, wanted (+27 more)

### Community 18 - "Rust Text Reader"
Cohesion: 0.07
Nodes (32): cell_label(), cell_list(), describe(), incident_name(), tool_name(), Candidate, candidate(), candidates() (+24 more)

### Community 19 - "Warden Board Reader"
Cohesion: 0.06
Nodes (56): buildState(), CellModel, ChoiceKind, EventKindModel, field(), integer(), jsNumber(), label() (+48 more)

### Community 20 - "Vorax Settings and Play"
Cohesion: 0.08
Nodes (54): canRefresh(), DEFAULT_SETTINGS, ultimateActivity(), Action, playWork(), Ahead, BASIC_FALLBACK, BASIC_IDS (+46 more)

### Community 21 - "Vorax Web Build"
Cohesion: 0.09
Nodes (34): w, Reading, ROUND, PreyMark, TOOLS, decodePngRaw(), loadLayouts(), loadPng() (+26 more)

### Community 22 - "Warden Scene Arrows"
Cohesion: 0.08
Nodes (50): ARROW, arrowScores(), beastAt(), beastClass(), beastFeature(), beastNamed(), buildTemplates(), CLASSES (+42 more)

### Community 23 - "Vorax TUI Script"
Cohesion: 0.06
Nodes (41): advise(), advisor, applyReading(), arg(), BASE, cap, connectLog(), draw() (+33 more)

### Community 24 - "Vorax Card Rendering"
Cohesion: 0.09
Nodes (52): cardArt(), cardsPresent(), cardText(), dot(), FACE_MIDDLE, fanSize(), FINE, fitOffset() (+44 more)

### Community 25 - "Rust Alpha Blending Mark"
Cohesion: 0.04
Nodes (13): ARM, ARROW_GAP, ARROW_H, ARROW_W, brackets_and_arrow_are_gold_and_the_target_clear(), EDGE, EDGE_ALPHA, GOLD (+5 more)

### Community 26 - "Vorax Replay Scripts"
Cohesion: 0.09
Nodes (42): D, createReader(), frame(), DATA, Frame, sureness(), gameArea(), GameWindow (+34 more)

### Community 27 - "Arcana Parser"
Cohesion: 0.09
Nodes (48): CELL_WHAT, CellWhat, Fact, HAND_WHAT, HandWhat, parseLine(), RARITIES, Rarity (+40 more)

### Community 28 - "Warden Instrument Icons"
Cohesion: 0.10
Nodes (44): boxDownscale(), embeddedIcons(), GRID, Icons, ranked(), readHeld(), score(), Slot (+36 more)

### Community 29 - "Tracker App Screen"
Cohesion: 0.10
Nodes (27): draw(), WINDOW_TOOLS, panelTitle(), TrackerScreen, BagRow, bagRows(), filterRows(), filterTerms() (+19 more)

### Community 30 - "Community 30"
Cohesion: 0.07
Nodes (40): Beast, .ALL, Lion, Mammoth, Rat, Wolf, CAGE_FIGHT, Data (+32 more)

### Community 31 - "Community 31"
Cohesion: 0.07
Nodes (26): read_model(), read_panels(), read_scene(), panels_against_labels(), rerolls_read(), strings(), cell8_incident_reads_at_1080p(), consume_target_reads_open() (+18 more)

### Community 32 - "Community 32"
Cohesion: 0.12
Nodes (38): data(), hash_seed(), a_full_vault_stops_inmates_at_ultimate(), add_marker(), advance_day(), after_growth(), begin_day(), destinations_from_dice() (+30 more)

### Community 33 - "Community 33"
Cohesion: 0.07
Nodes (39): Licence split (warden GPL-3.0-only, vorax MIT), AGENTS.md (contribution rules), Arcana app README, Arcana log semantics (S9Taro/S9Challenge events), Dashboard app README, Dashboard minigame status badges, Tool registry (TOOLS in packages/launch/src/tools.ts), Loot tracker app README (+31 more)

### Community 34 - "Community 34"
Cohesion: 0.05
Nodes (45): Beast portrait identification (Rat, Wolf, Lion, Mammoth), Chromatic Prisoner panel and hexagon slots, Destination cards and distinct-dice-steps rule, Torture Instrument icon matching (31 icons), S16 Tartarus prison screen layout (reader's view), Rarity glow colours (white/blue/purple/orange/red), grim silent screen capture, niri msg game-window discovery (+37 more)

### Community 35 - "Community 35"
Cohesion: 0.05
Nodes (37): createHighlighter(), { app, BrowserWindow, Menu, Tray, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, net, screen, session, shell }, applyCapturable(), capturable(), { execFile, spawn }, frameRect(), fromHelper(), fs (+29 more)

### Community 36 - "Community 36"
Cohesion: 0.07
Nodes (29): load_png(), a_frame_during_a_read_waits_for_it(), black(), consume_target_follows_the_jaws(), frame_size_is_scaled_or_refused(), hidden_counter_keeps_the_day(), hidden_counter_on_the_run_start_pick_is_day_one(), hunt_pick_keeps_manage_read() (+21 more)

### Community 37 - "Community 37"
Cohesion: 0.11
Nodes (29): AppHooks, VoraxApp, onKey(), reportLines(), boldTone(), VoraxScreen, Block, Board (+21 more)

### Community 38 - "Community 38"
Cohesion: 0.08
Nodes (43): shapeLine(), BUTTON, CELL, Click, DOOR, PICK, REROLL, sameSpot() (+35 more)

### Community 39 - "Community 39"
Cohesion: 0.08
Nodes (27): scope, SolveJob, State, StateInit, Rng32, TOOL_RANK, landed(), landingGain() (+19 more)

### Community 40 - "Community 40"
Cohesion: 0.07
Nodes (18): board(), courtyard(), DARK_GREEN, describe(), GAP, initial(), LEADER, MARKER (+10 more)

### Community 41 - "Community 41"
Cohesion: 0.10
Nodes (42): advice(), applyReading(), boot(), changed(), connect(), counts(), dbgCount(), dbgRead() (+34 more)

### Community 42 - "Community 42"
Cohesion: 0.07
Nodes (41): Debug bundle, Replay script (scripts/replay.ts), Highlight window markup (mark.html), Overlay card UI (overlay.html), Overlay debug report prompt, Game log (UE_game.log), Desktop hotkeys (Ctrl+Alt+V/H/X/J), Vorax Helper Windows desktop app (+33 more)

### Community 43 - "Community 43"
Cohesion: 0.12
Nodes (34): Child, defaultHost, LauncherHost, LauncherOptions, OpenReason, OpenRequest, OpenResult, Running (+26 more)

### Community 44 - "Community 44"
Cohesion: 0.11
Nodes (39): app, escape(), frame, history, lines, names, rgb(), state (+31 more)

### Community 45 - "Community 45"
Cohesion: 0.09
Nodes (15): builds_like_the_js(), first_diff(), fixture(), follow_js_repeat(), no_cap(), normalize(), record(), recorded() (+7 more)

### Community 46 - "Community 46"
Cohesion: 0.11
Nodes (24): can_devour_now(), start_options(), chain_odds(), Comp, composition(), context(), Ctx, decide() (+16 more)

### Community 47 - "Community 47"
Cohesion: 0.07
Nodes (28): BANNER, BUTTON_ABOVE, CANCEL, CANCEL_AT, CARD_PITCH, CARDS, DAYS, DIALOG (+20 more)

### Community 48 - "Community 48"
Cohesion: 0.07
Nodes (6): BAG_PAGES, Delta, Instance, Inventory, Slot, PriceStore

### Community 49 - "Community 49"
Cohesion: 0.09
Nodes (29): readWithTesseract(), Rgba, savePng(), cache, cacheKey(), cropHash(), encode(), localContrast() (+21 more)

### Community 50 - "Community 50"
Cohesion: 0.12
Nodes (32): instrument(), runEndOfRound(), potion(), dealInstruments(), dealPotions(), pickBy(), beginRound(), canConfirm() (+24 more)

### Community 51 - "Community 51"
Cohesion: 0.10
Nodes (23): AROUND, bitmap(), encode(), engine(), FOUND, is_english(), Job, language() (+15 more)

### Community 52 - "Community 52"
Cohesion: 0.10
Nodes (37): a_second_treasure_pick_covers_the_board_after_the_first(), a_treasure_without_a_theme_has_one_pick(), advised_instrument_is_held_after_the_pick(), advised_on_t031(), advised_reroll_is_not_held(), blip(), blip_keeps_the_corrections(), board_after_a_chain_is_taken() (+29 more)

### Community 53 - "Community 53"
Cohesion: 0.08
Nodes (29): STEAM_APP, atLineStart(), BOARD_CLOSED_STATUS, CaptureAttempt, CaptureGate, classifyLine(), createFollower, follow() (+21 more)

### Community 54 - "Community 54"
Cohesion: 0.08
Nodes (25): createWatch(), WATCH_MS, WATCH_W, WatchOptions, watchThumb(), canvas(), NotAWindowError, pixels() (+17 more)

### Community 55 - "Community 55"
Cohesion: 0.13
Nodes (18): AppHooks, ArcanaApp, ArcanaScreen, chunksOf(), HELP, HELP_TEXT, helpChunks(), ListPanel (+10 more)

### Community 56 - "Community 56"
Cohesion: 0.08
Nodes (22): action_cell(), Args, args(), BOLD, DIM, footer(), GREEN, keys() (+14 more)

### Community 57 - "Community 57"
Cohesion: 0.09
Nodes (20): Cell, EventRef, Inmate, Nest, ObjectiveState, Params, Phase, Ended (+12 more)

### Community 58 - "Community 58"
Cohesion: 0.08
Nodes (29): PROTOCOLS, handAt(), HandRead, cardFace(), TankRead, letters(), nameFit(), NAMES (+21 more)

### Community 59 - "Community 59"
Cohesion: 0.06
Nodes (26): AFTER_RUN_CELLS, BLOCK_DIFF, cell_sight(), changed(), CHANGED, CHANGED_BLOCKS, CHECK_CELL, differs() (+18 more)

### Community 60 - "Community 60"
Cohesion: 0.11
Nodes (5): Meal, scan(), Scanned, Session, tool_keys()

### Community 61 - "Community 61"
Cohesion: 0.10
Nodes (4): fd, started, tracker, Tracker

### Community 62 - "Community 62"
Cohesion: 0.09
Nodes (14): fromSaved(), bump(), MAP_LEVEL_TYPES, PRISON_LEVEL_TYPES, PRISON_PAGES, RunSegmenter, PRISON_NAME, ZONE_NAMES (+6 more)

### Community 63 - "Community 63"
Cohesion: 0.11
Nodes (20): clean(), KEEP(), main(), civil(), folderName(), frameName(), isRunFolder(), prune() (+12 more)

### Community 64 - "Community 64"
Cohesion: 0.11
Nodes (24): B1(), c1(), i(), E1(), u(), Fn(), g1(), h1() (+16 more)

### Community 65 - "Community 65"
Cohesion: 0.18
Nodes (23): Item, best_meal(), bite(), choose(), coin_of_fate(), devour_delta(), fed(), feed() (+15 more)

### Community 66 - "Community 66"
Cohesion: 0.09
Nodes (11): CONF, index(), read_board(), RUN_DAYS, TIER_CONF, to_model(), Warning, WarningKind (+3 more)

### Community 67 - "Community 67"
Cohesion: 0.12
Nodes (21): bench(), changed_weights_change_the_strategy_runs(), each_game(), Game, GUARD, held_instruments_start_in_the_tools(), is_low(), LOW (+13 more)

### Community 68 - "Community 68"
Cohesion: 0.16
Nodes (30): allowed(), ARCH, boardOf(), canExport(), canSend(), card(), cardList(), cardPicture() (+22 more)

### Community 69 - "Community 69"
Cohesion: 0.12
Nodes (27): clipToOutput(), coversOutput(), fillsOutput(), grimGeometry(), intersects(), NiriOutput, NiriWindow, NiriWorkspace (+19 more)

### Community 70 - "Community 70"
Cohesion: 0.11
Nodes (29): addWiki(), displayName(), familyAttribute(), ItemEntry, ItemSource, ItemTable, main(), normalize() (+21 more)

### Community 71 - "Community 71"
Cohesion: 0.16
Nodes (5): TrackerApp, ScreenHooks, onKey(), Panel, setup()

### Community 72 - "Community 72"
Cohesion: 0.13
Nodes (12): is_png(), out!, main(), number(), run_bench(), run_capture(), run_read(), run_solve() (+4 more)

### Community 73 - "Community 73"
Cohesion: 0.12
Nodes (22): box_downscale(), EMPTY_SPREAD, GRID, held_frames_read(), ICON_PX, Icons, labeled_board_frames_read(), labels() (+14 more)

### Community 74 - "Community 74"
Cohesion: 0.11
Nodes (24): Capture, alphaOf(), be16(), CHANNELS, chunk(), crc32(), CRC_TABLE, decode() (+16 more)

### Community 75 - "Community 75"
Cohesion: 0.09
Nodes (28): dependencies, @opentui/core@0.8.0, @tli/capture@workspace:*, @tli/gamelog@workspace:*, @tli/ocr@workspace:*, @tli/png@workspace:*, @tli/tui@workspace:*, devDependencies (+20 more)

### Community 76 - "Community 76"
Cohesion: 0.16
Nodes (26): readText(), TextRead, glyphVector(), hsv(), Img, sample(), Alts, archetypeOf() (+18 more)

### Community 77 - "Community 77"
Cohesion: 0.09
Nodes (28): dependencies, @opentui/core@0.8.0, @tli/capture@workspace:*, @tli/gamelog@workspace:*, @tli/ocr@workspace:*, @tli/png@workspace:*, @tli/tui@workspace:*, devDependencies (+20 more)

### Community 78 - "Community 78"
Cohesion: 0.13
Nodes (23): ASSET, check(), clean_old(), download(), hex32(), JSON, LATEST, latest_json() (+15 more)

### Community 79 - "Community 79"
Cohesion: 0.17
Nodes (27): best_match(), buttons(), completed_tail(), days(), days_counter(), distance(), door(), doors() (+19 more)

### Community 81 - "Community 81"
Cohesion: 0.08
Nodes (4): Hotkey, parse(), two_at_once(), Key

### Community 82 - "Community 82"
Cohesion: 0.13
Nodes (13): defaultLogs(), main(), readLog(), readTable(), Seen, Tracker, dumpScope(), Fact (+5 more)

### Community 83 - "Community 83"
Cohesion: 0.10
Nodes (26): dependencies, @opentui/core@0.8.0, @tli/arcana@workspace:*, @tli/gamelog@workspace:*, @tli/tracker@workspace:*, @tli/tui@workspace:*, devDependencies, @types/bun@latest (+18 more)

### Community 84 - "Community 84"
Cohesion: 0.09
Nodes (26): bin, tli, dependencies, @opentui/core@0.8.0, @tli/gamelog@workspace:*, @tli/launch@workspace:*, @tli/tui@workspace:*, devDependencies (+18 more)

### Community 85 - "Community 85"
Cohesion: 0.10
Nodes (26): dependencies, @opentui/core@0.8.0, @tli/gamelog@workspace:*, @tli/launch@workspace:*, @tli/tracker@workspace:*, @tli/tui@workspace:*, devDependencies, @types/bun@latest (+18 more)

### Community 86 - "Community 86"
Cohesion: 0.07
Nodes (26): jobs, windows, name, permissions, contents, branches, paths, tags (+18 more)

### Community 87 - "Community 87"
Cohesion: 0.13
Nodes (17): is_run_folder(), ENDPOINT, gzip(), live_upload(), pending(), pending_runs(), READ, Request (+9 more)

### Community 88 - "Community 88"
Cohesion: 0.17
Nodes (23): BACK_TO_HIDEOUT, BAG_DUMP, BAG_DUMP_PLAIN, BAG_SNAPSHOT, COMMUNITY_PRICES, ENGINE_NOISE, ENTER_MAP, ENTER_PRISON (+15 more)

### Community 89 - "Community 89"
Cohesion: 0.24
Nodes (21): App, startApp(), StartAppOptions, clip(), clock(), fit(), fitEnd(), isCombining() (+13 more)

### Community 90 - "Community 90"
Cohesion: 0.15
Nodes (11): append(), civil(), folder_name(), frames_are_numbered_once_per_board(), Line, Job, Flush, Write (+3 more)

### Community 91 - "Community 91"
Cohesion: 0.11
Nodes (13): consume_targets(), DaysClock, kept_days(), kept_line(), Reading, run_start(), steady_key(), Taken (+5 more)

### Community 92 - "Community 92"
Cohesion: 0.19
Nodes (7): read_screen(), run(), main(), read_screen(), strip(), read_screen(), run()

### Community 93 - "Community 93"
Cohesion: 0.16
Nodes (24): clickLine(), findGameWindow(), lookForGame(), lowerPriority(), makeHelper(), makeOverlay(), note(), onScreen() (+16 more)

### Community 94 - "Community 94"
Cohesion: 0.13
Nodes (23): _0(), an(), en(), Et(), ft(), G(), K(), nn() (+15 more)

### Community 95 - "Community 95"
Cohesion: 0.12
Nodes (16): arrow(), ARROW_AT, gate(), GATE_AT, gradient(), grey(), HINT_SPAN, luma() (+8 more)

### Community 96 - "Community 96"
Cohesion: 0.16
Nodes (10): append_to(), finish(), main(), read_screen(), run(), run_child(), spawn(), steam_home() (+2 more)

### Community 97 - "Community 97"
Cohesion: 0.15
Nodes (15): at(), board_cells_on_target_and_cell_picks(), BUTTON, CELL, Click, DOOR, doors_and_buttons(), instrument_cards_and_reroll() (+7 more)

### Community 98 - "Community 98"
Cohesion: 0.29
Nodes (12): HELP, ListPanel, backgroundColor(), borderColor(), color(), colorEnabled(), colors, defaultBackground() (+4 more)

### Community 99 - "Community 99"
Cohesion: 0.10
Nodes (21): win32, dependencies, electron-updater@^6.3.9, koffi@2.16.3, description, devDependencies, electron@44.5.1, electron-builder@26.16.1 (+13 more)

### Community 100 - "Community 100"
Cohesion: 0.11
Nodes (20): CARD_ART, CARD_FACE, CARD_LOCAL, CARD_SHIFT, CARD_TILT, CardPos, HAND5, HAND_SCALES (+12 more)

### Community 101 - "Community 101"
Cohesion: 0.18
Nodes (15): desktop_path(), desktop_path_is_in_an_existing_folder(), desktop_shortcut(), install(), install_dir(), installed_here(), installed_here_paths(), register() (+7 more)

### Community 102 - "Community 102"
Cohesion: 0.24
Nodes (15): APP_ID, capture(), capture_with(), CaptureOptions, filled_output(), find(), grim(), live_niri_socket() (+7 more)

### Community 103 - "Community 103"
Cohesion: 0.28
Nodes (15): a_tied_card_pick_still_names_one_card(), Advice, advice_in_a_tie_rates_the_pick_as_good(), advice_takes_the_playouts_best(), advise(), also_good(), changes_nothing(), gift_at() (+7 more)

### Community 104 - "Community 104"
Cohesion: 0.12
Nodes (20): dependencies, @tli/gamelog@workspace:*, @tli/tracker@workspace:*, devDependencies, @types/bun@latest, @types/node@latest, typescript@^5.9.0, exports (+12 more)

### Community 105 - "Community 105"
Cohesion: 0.19
Nodes (20): $1(), ae(), d0(), D1(), dt(), f0(), h0(), I0() (+12 more)

### Community 106 - "Community 106"
Cohesion: 0.12
Nodes (19): devDependencies, @types/bun@latest, @types/node@latest, typescript@^5.9.0, exports, @types/bun, @types/node, typescript (+11 more)

### Community 107 - "Community 107"
Cohesion: 0.12
Nodes (14): ansi(), best, css(), given, html(), htmlSize, loot, memory (+6 more)

### Community 108 - "Community 108"
Cohesion: 0.13
Nodes (16): INSTRUMENTS, FEATURE_NAMES, features(), HEAD, INDEX, model, PAIR_AT(), PAIRED (+8 more)

### Community 109 - "Community 109"
Cohesion: 0.20
Nodes (9): Event, Frame, Status, Window, lock(), sample(), Shared, watch() (+1 more)

### Community 110 - "Community 110"
Cohesion: 0.19
Nodes (14): fingerprint(), scan(), layOutScaled(), readScene(), Blocking, fromPpm(), main(), ms() (+6 more)

### Community 111 - "Community 111"
Cohesion: 0.13
Nodes (18): dependencies, @tli/png@workspace:*, devDependencies, @types/bun@latest, @types/node@latest, typescript@^5.9.0, exports, @tli/png (+10 more)

### Community 112 - "Community 112"
Cohesion: 0.13
Nodes (18): dependencies, @tli/gamelog@workspace:*, devDependencies, @types/bun@latest, @types/node@latest, typescript@^5.9.0, exports, @tli/gamelog (+10 more)

### Community 113 - "Community 113"
Cohesion: 0.13
Nodes (18): dependencies, @opentui/core@0.8.0, devDependencies, @types/bun@latest, @types/node@latest, typescript@^5.9.0, exports, @opentui/core (+10 more)

### Community 114 - "Community 114"
Cohesion: 0.18
Nodes (14): DashboardHooks, DashboardState, BADGE, ToolLine, ToolRow, VIEW, AppHooks, GameName (+6 more)

### Community 115 - "Community 115"
Cohesion: 0.22
Nodes (4): DashboardApp, DashboardScreen, toolRows(), setup()

### Community 116 - "Community 116"
Cohesion: 0.11
Nodes (17): compilerOptions, baseUrl, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 117 - "Community 117"
Cohesion: 0.18
Nodes (8): close(), decide_rerolls_only_a_low_ranked_offer(), option(), point(), point_diff(), same_option(), SOLVES, solves_as_recorded()

### Community 118 - "Community 118"
Cohesion: 0.11
Nodes (17): compilerOptions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+9 more)

### Community 119 - "Community 119"
Cohesion: 0.15
Nodes (15): app, firstRead(), flag(), games, given, onKey(), quit(), reader (+7 more)

### Community 120 - "Community 120"
Cohesion: 0.12
Nodes (16): compilerOptions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 121 - "Community 121"
Cohesion: 0.16
Nodes (9): frame_name(), FRAME_QUALITY, Jpeg, KEEP, MISS_FRAME_EVERY, prune(), prune_keeps_the_newest(), save_jpeg() (+1 more)

### Community 122 - "Community 122"
Cohesion: 0.15
Nodes (16): shape_line(), Anchor, Centre, End, Start, frame_point(), frame_point_at_unit_scale(), frame_point_matches_taps() (+8 more)

### Community 123 - "Community 123"
Cohesion: 0.12
Nodes (16): compilerOptions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 124 - "Community 124"
Cohesion: 0.12
Nodes (16): compilerOptions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 125 - "Community 125"
Cohesion: 0.12
Nodes (16): compilerOptions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 126 - "Community 126"
Cohesion: 0.24
Nodes (8): Move, WardenScreen, freshView(), RingView, ViewState, model(), setup(), tone

### Community 127 - "Community 127"
Cohesion: 0.21
Nodes (9): capture(), capture_window(), fail(), find_window(), first_frame(), screen_copy(), time_frames(), fingerprint() (+1 more)

### Community 128 - "Community 128"
Cohesion: 0.17
Nodes (10): bitten(), casket_meals(), CellEdit, Empty, Inmate, Locked, chains_vaulted(), prey_cells() (+2 more)

### Community 129 - "Community 129"
Cohesion: 0.17
Nodes (4): in_background(), Which, Auto, Read

### Community 130 - "Community 130"
Cohesion: 0.15
Nodes (15): dependencies, @tli/capture@workspace:*, devDependencies, @types/bun@latest, @types/node@latest, exports, @tli/capture, @types/bun (+7 more)

### Community 131 - "Community 131"
Cohesion: 0.13
Nodes (14): compilerOptions, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, noUnusedLocals (+6 more)

### Community 132 - "Community 132"
Cohesion: 0.13
Nodes (14): compilerOptions, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, noUnusedLocals (+6 more)

### Community 133 - "Community 133"
Cohesion: 0.13
Nodes (15): build, appId, asarUnpack, directories, files, nsis, productName, publish (+7 more)

### Community 134 - "Community 134"
Cohesion: 0.22
Nodes (11): changeGate(), FrameMeta, frameName(), saveFrame(), saveReading(), TICK_MS, write(), frameDiff() (+3 more)

### Community 135 - "Community 135"
Cohesion: 0.22
Nodes (12): client_rect(), describe(), find(), game_in_front(), ours(), own_or_console(), process_file(), Search (+4 more)

### Community 136 - "Community 136"
Cohesion: 0.20
Nodes (3): app_dir(), old_default_rollouts_raised(), Settings

### Community 137 - "Community 137"
Cohesion: 0.13
Nodes (14): Screen, CellPick, ChainTarget, DayBanner, InstrumentPick, Interrogation, Manage, Patrol (+6 more)

### Community 138 - "Community 138"
Cohesion: 0.13
Nodes (14): name, private, scripts, arcana, dashboard, start, test, tracker (+6 more)

### Community 139 - "Community 139"
Cohesion: 0.13
Nodes (14): compilerOptions, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, noUnusedLocals (+6 more)

### Community 140 - "Community 140"
Cohesion: 0.13
Nodes (14): compilerOptions, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, noUnusedLocals (+6 more)

### Community 141 - "Community 141"
Cohesion: 0.22
Nodes (5): main(), read_screen(), run(), main(), run_log()

### Community 142 - "Community 142"
Cohesion: 0.14
Nodes (13): VORAX Overlay Card Screenshot, Alternative Moves List (Twin Hormone 66%, Refresh the hand 58%), Deep Check Confidence (71% to reach 925,000), Header Controls (Snap, Helper, minimize buttons), Next Move Recommendation Panel, VORAX Helper Overlay Widget, Sample Warden Patrol Screenshot (Tartarus Prison), Select a Destination / Cell Selection UI (+5 more)

### Community 143 - "Community 143"
Cohesion: 0.23
Nodes (11): centre(), centreOf(), centres, iconSimilarity(), moved(), allIcons(), holdsAnIcon(), ICON_PREFIX (+3 more)

### Community 144 - "Community 144"
Cohesion: 0.20
Nodes (7): decode_png_raw(), load_layouts(), Rect, REF_H, REF_W, Rgba, save_png()

### Community 146 - "Community 146"
Cohesion: 0.24
Nodes (9): freshState(), viewSignature(), launch(), q(), sh(), tmux(), dashboard(), Outcome (+1 more)

### Community 148 - "Community 148"
Cohesion: 0.17
Nodes (13): adminBlock(), buildBundle(), builtCollector(), findLog(), previewReport(), regQuery(), runDir(), saveRunBundle() (+5 more)

### Community 149 - "Community 149"
Cohesion: 0.22
Nodes (4): main(), read_screen(), run(), strip()

### Community 150 - "Community 150"
Cohesion: 0.19
Nodes (13): bn(), Bt(), ke(), Kt(), L0(), lt(), pe(), qt() (+5 more)

### Community 151 - "Community 151"
Cohesion: 0.27
Nodes (7): action_cell(), auto_button(), move_name(), read_button(), riot(), short(), sliders_tab()

### Community 152 - "Community 152"
Cohesion: 0.15
Nodes (10): Pending, Cell, Chain, Gift, Interrogation, Prey, Tool, ToolReason (+2 more)

### Community 153 - "Community 153"
Cohesion: 0.23
Nodes (7): Launcher, childEnv(), childFlags(), openTool(), OpenToolOptions, SESSION_VARS, missing()

### Community 154 - "Community 154"
Cohesion: 0.20
Nodes (4): dpi_aware(), game_rect(), on_screen(), Mark

### Community 155 - "Community 155"
Cohesion: 0.29
Nodes (11): hint_gives_the_full_search_scale(), lay_out(), lay_out_scaled(), lay_out_title(), paint(), reference(), scaled_frame_lands_on_reference_points(), shifted_frame_has_unit_scale() (+3 more)

### Community 156 - "Community 156"
Cohesion: 0.38
Nodes (10): draw(), fieldsTable(), fixedKeys(), frameFor(), go(), kind(), open(), status() (+2 more)

### Community 157 - "Community 157"
Cohesion: 0.22
Nodes (7): Run, GameState, atLeast(), buildProgress(), count(), Groups, NEEDS

### Community 158 - "Community 158"
Cohesion: 0.51
Nodes (7): endpoint(), flush(), init(), notice(), report(), save(), stat()

### Community 159 - "Community 159"
Cohesion: 0.22
Nodes (10): a0(), a1(), effect(), endOfRound(), k1(), T0(), U1(), Ue() (+2 more)

### Community 160 - "Community 160"
Cohesion: 0.22
Nodes (5): { contextBridge, ipcRenderer }, { contextBridge, ipcRenderer }, { contextBridge, ipcRenderer }, { contextBridge, ipcRenderer }, electron

### Community 161 - "Community 161"
Cohesion: 0.29
Nodes (7): DEFAULT_SHELLEY_LEVEL, INSTRUMENT_BONUS, instrumentRefreshesFor(), POTION_REFRESHES, settingsForShelley(), SHELLEY_LEVELS, Settings

### Community 163 - "Community 163"
Cohesion: 0.36
Nodes (4): client(), get(), post(), USER_AGENT

### Community 164 - "Community 164"
Cohesion: 0.57
Nodes (4): Found, Mark, measure(), Strip

### Community 165 - "Community 165"
Cohesion: 0.25
Nodes (7): exports, main, name, private, scripts, test, type

### Community 166 - "Community 166"
Cohesion: 0.29
Nodes (4): from, fs, path, to

### Community 168 - "Community 168"
Cohesion: 0.48
Nodes (6): baseTypes(), fetchPage(), ids(), main(), SLOTS, wait()

### Community 169 - "Community 169"
Cohesion: 0.33
Nodes (3): VIAL_COUNT, VIAL_LEVELS, VialTier

### Community 170 - "Community 170"
Cohesion: 0.47
Nodes (3): addLocalRef(), exportLocalRefs(), loadLocalRefs()

### Community 171 - "Community 171"
Cohesion: 0.67
Nodes (5): done(), open(), send(), status(), what()

### Community 172 - "Community 172"
Cohesion: 0.53
Nodes (4): gui(), main(), show_error(), USAGE

### Community 173 - "Community 173"
Cohesion: 0.33
Nodes (5): exports, main, name, private, type

### Community 174 - "Community 174"
Cohesion: 0.60
Nodes (4): env(), RULES, scrubFiles(), scrubText()

### Community 177 - "Community 177"
Cohesion: 0.40
Nodes (5): How, Patrol, Side, Start, Tool

### Community 179 - "Community 179"
Cohesion: 0.83
Nodes (3): open(), refresh(), render()

### Community 180 - "Community 180"
Cohesion: 0.50
Nodes (4): Tab, Board, Run, Settings

### Community 181 - "Community 181"
Cohesion: 0.83
Nodes (3): icon_score(), luma_stats(), slot_scores()

## Knowledge Gaps
- **146 isolated node(s):** `warden`, `Locked`, `Empty`, `Inmate`, `Installed` (+141 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1462 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **27 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `data()` connect `Community 32` to `Community 128`, `Rust Warden Actions`, `Rust Gifts and Devour`, `Rust Beasts and Markers`, `Rust Board Reader`, `Rust Scoring Tests`, `Rust Text Reader`, `Community 151`, `Community 30`, `Community 31`, `Community 167`, `Community 40`, `Community 46`, `Community 56`, `Community 57`, `Community 65`, `Community 66`, `Community 73`, `Community 79`, `Community 80`, `Community 91`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Are the 111 inferred relationships involving `data()` (e.g. with `main()` and `chains_vaulted()`) actually correct?**
  _`data()` has 111 INFERRED edges - model-reasoned connections that need verification._
- **What connects `warden`, `Locked`, `Empty` to the rest of the system?**
  _146 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Warden Engine Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.06310380267214799 - nodes in this community are weakly interconnected._
- **Why does `build` connect `Community 133` to `Community 99`, `Rust Scoring Tests`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Are the 48 inferred relationships involving `load_png()` (e.g. with `.read_png()` and `misses()`) actually correct?**
  _`load_png()` has 48 INFERRED edges - model-reasoned connections that need verification._
- **Should `Warden Objectives and Cells` be split into smaller, more focused modules?**
  _Cohesion score 0.06848484848484848 - nodes in this community are weakly interconnected._
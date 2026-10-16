# Coding plans research (as of 2026-10-16)

Method: official pages where fetchable; otherwise third-party (marked T). Official pricing pages often do not render, so prices marked T need checking in a browser. Nothing signed up for.

## Summary table

| Provider / plan | Tiers, USD/mo | Quota | Overage | Anthropic endpoint |
|---|---|---|---|---|
| Z.ai GLM Coding Plan | Lite 18, Pro 72-80, Max 160-168 (T, conflicting); annual ~30% off (T) | Credits: Lite 2,000/5h and 10,000/wk; Pro 12,000 / 60,000; Max 28,000 / 140,000 | None; wait for next 5h window, balance not charged | Yes `https://api.z.ai/api/anthropic` |
| Kimi Code | Moderato 19, Allegretto 39, Allegro 99, Vivace 199 (T, Jul 2026); China names Go/Plus/Pro/Max at CNY 49/99/199/699 (T) | Rolling 5h limit, numbers not published; older docs say 7-day cycle; multipliers ~1x/5x/15x/30x (T) | Not found | Yes (OpenAI + Anthropic, overseas URL) |
| Alibaba QwenCloud/Bailian | Token Plan (T, promo): Lite 6, Essential 10, Standard 18, Pro 68. Old Coding Plan Pro 50 | Token Plan credits/month: 11,500 / 25,500 / 45,000 / 180,000, no weekly cap (T). Old Pro: 6,000 req/5h, 45,000/wk, 90,000/mo | Calls pause; no PAYG fallback | Yes `https://coding-intl.dashscope.aliyuncs.com/apps/anthropic` |
| Xiaomi MiMo Token Plan | Lite 6, Standard 16, Pro 50, Max 100 | Credits/mo: 4.1B / 11B / 38B / 82B | None; service suspended at 0 | Yes `https://token-plan-sgp.xiaomimimo.com/anthropic` |
| DeepSeek API | PAYG | see below | n/a | Yes `https://api.deepseek.com/anthropic` |
| MiniMax Token/M Plan | Plus 20, Max 50, Ultra 120 (T); official page shows Go/Explore/Build 1x/3x/7.5x, no prices | ~4,500 / 15,000 / 29,077 M2.7 calls per 5h (T) | Not found | Not confirmed |
| BytePlus ModelArk Coding Plan | Lite 10, Pro 50 (T) | Lite ~1,900 req/5h, 12,000/wk, 24,000/mo; Pro 5x (T) | Not found | Not confirmed |
| Tencent Cloud Token Plan | Lite 7, Standard 17, Pro 51, Max 103 (T) | 1,000 / 2,600 / 7,900 / 15,900 credits/mo (T) | Not found | Not confirmed |
| StepFun Step Plan | Flash Mini 6.99, Plus 9.99, Pro 29, Max 99 (T) | 400M / 1,600M / 8,000M / 40,000M credits/mo | Separate from PAYG | Not found |

## 1. Z.ai GLM Coding Plan
- Models: GLM-5.3, GLM-5.3-Flash on all tiers; GLM-5.2/5.1 requests route to 5.3, GLM-4.7 to 5.3-Flash. Source: https://docs.z.ai/devpack/overview (fetched 2026-10-16).
- Cost per call: GLM-5.3 charges 6.9 / 1.7 / 24 credits (input / cached / output, per 10,000 credits). Off-peak is 50 % (peak is Mon-Fri 14:00-18:00 UTC+8). Same source.
- Older prompt-based estimates: ~80 / 400 / 1,600 prompts per 5h, ~400 / 2,000 / 8,000 per week (T, https://www.layer3labs.io/guides/z-ai-pricing, Jul 2026). Credits are now the unit.
- Prices: docs say "from 18 USD". Pro/Max are conflicting (T: https://www.aipricing.guru/z-ai-subscription-pricing/, https://www.scriptbyai.com/ai-coding-plan-comparison/ 2026-10-12: 18 / 80 / 168; annual 12.60 / 56 / 117.60). Intro discounts may expire; not found.
- Concurrency: not found. Overage: none (https://docs.z.ai/devpack/faq).
- Bench (vendor, HF card https://huggingface.co/zai-org/glm-5.3): Terminal-Bench 2.1 88.2 vs Kimi K3 88.3 and DeepSeek-V4 Pro-0813 87.9. Third party (T, gradually.ai, Aug 2026): SWE-bench Verified 95.4 %, Terminal-Bench 2.1 71.5 %. Large harness spread, treat with caution.

## 2. Kimi Code
- Models: k3 (1M ctx), k3-256k, kimi-for-coding, kimi-for-coding-highspeed; each needs a specific tier; K3 on "higher tiers" (https://www.kimi.com/code/docs/, fetched 2026-10-16).
- Prices (T): Moderato 19, Allegretto 39, Allegro 99, Vivace 199 (https://www.codeagentswarm.com/en/guides/kimi-code-plans-and-pricing, Jul 2026). China Go not including Kimi Code; Plus/Pro/Max have a rolling 5h limit and no weekly cap (T, scriptbyai 2026-10-12). The two sources disagree on weekly vs 5h; not resolved.
- Concurrency: higher tiers get more (no numbers). Max 5 API keys. Spoofing client User-Agent risks suspension.
- Bench: K3 88.3 Terminal-Bench 2.1 (Z.ai card, vendor-compared). No SWE-bench found.

## 3. Alibaba Model Studio / QwenCloud
- Official page (https://www.alibabacloud.com/help/model-studio/coding-plan, 2026-10-16): Pro 50 USD, 6,000 req/5h, 45,000/wk, 90,000/mo; Lite closed to new subs 2026-03-20, upgrades ended 2026-04-13. Pro is limited stock, restocked daily 00:00 UTC+8, non-refundable. Models listed: qwen3.7-plus, qwen3.6-plus, qwen3.5-plus, kimi-k2.5, glm-5, MiniMax-M2.5. DeepSeek not listed, not found on this page.
- Newer "Token Plan" (T, scriptbyai 2026-10-12): promo Lite 6 (likely the user's tier), Essential 10, Standard 18, Pro 68; monthly credits 11,500 / 25,500 / 45,000 / 180,000. Promo prices; expiry not found. qwen3.8-flash/max and DeepSeek inclusion not confirmed.
- Overage: calls pause. Using the normal API key bills PAYG.

## 4. Xiaomi MiMo Token Plan
Source: https://mimo.mi.com/docs/en-US/tokenplan/Token%20Plan/subscription (2026-10-16).
- Credits per token (cache hit / miss / output): v2.6-pro 2.5 / 300 / 600; v2.6-flash 2 / 100 / 200. Pro costs 3x flash on miss and output.
- Off-peak 00:00-08:00 Beijing: 0.8x consumption.
- Annual: Lite 63.36, Std 168.96, Pro 528, Max 1,056 (12 % off monthly x12). 12 % off first purchase.
- Upgrades allowed, downgrades not. Coding tools only. No overage; suspended at 0.
- 5h limit / concurrency: not found. mimo-v2.5 and v2.5-pro go offline 2026-10-21 (routed to 2.6 from 10-14).
- Bench: not found for v2.6.
- Note: 4.1B Lite credits are about 41M flash cache-miss input tokens. A 14 USD tier does not exist on the page (nearest Standard 16).

## 5. Alternatives
| Option | Price | Notes |
|---|---|---|
| DeepSeek V4.1-Flash | Off-peak per 1M: 0.003 hit / 0.15 miss / 0.60 out; peak 2x | https://api-docs.deepseek.com/quick_start/pricing (2026-10-16). Peak 01-04 and 06-10 UTC Mon-Fri. |
| DeepSeek V4-Pro-0813 | Off-peak: 0.022 / 0.66 / 1.98; peak 2x | No promo listed. Terminal-Bench 2.1 87.9 (Z.ai card). Anthropic endpoint yes. |
| OpenRouter | PAYG, per-model | Not researched. Not found. |
| MiniMax | see table | M3.1 Flash Preview on all tiers (https://platform.minimax.io/docs/token-plan/intro). |
| BytePlus ModelArk | 10 / 50 | China Ark: Lite CNY 40 (first month 9.9), Pro 200 (T, codepick.dev). Promos may expire; dates not found. |
| Tencent | 7 / 17 / 51 / 103 | Hunyuan coding plan, no official page found. |
| StepFun | 6.99-99 | T, omidsaffari.com, checked 2026-09-21. |

## Observations for this project
- PAYG DeepSeek flash is very cheap: 1M cache-miss input plus 0.2M output about 0.27 USD off-peak. With cache hits, an agentic session is far below a 6-14 USD plan, and there is no hard stop at 100 %.
- Z.ai Lite (18) has credits roughly 48-97M GLM-5.3 tokens per week at 95 % cache hit (official estimate), larger than MiMo Lite per dollar, if GLM is the main coder.
- Verify before buying: Z.ai Pro/Max real prices, Kimi tier names and K3 gating, Alibaba Token Plan models.
- Not found: any concurrency numbers (all providers), SWE-bench Verified from vendors, MiMo/DeepSeek V4.1 benchmarks.

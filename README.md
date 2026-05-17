# AI News Image Evaluation Survey
### Participant Introduction & Overview

---

## What Are We Trying to Find Out?

News articles are almost always accompanied by a photograph. That photograph is either sourced by a journalist, licensed from an agency, or has to be left out entirely when no suitable image exists.

Modern AI image generation models can now produce photorealistic images from a text description in seconds. This raises a practical and scientifically interesting question:

> **Can AI-generated images substitute for real news photographs — and if so, which combination of tools produces the most convincing, relevant, and accurate result?**

This survey is the central data-collection component of a thesis investigating exactly that. We are not asking you to judge the ethics of using AI in journalism. We are asking you to act as a careful, honest viewer and tell us what you see.

---

## What Does the Survey Evaluate?

We have selected **100 real news articles** from four major English-language outlets:

- **BBC**
- **The Guardian**
- **USA Today**
- **The Washington Post**

For each article, we have generated a set of AI images using **6 different image generation models**:

| Model | Type |
|-------|------|
| Gemini 2.5 Flash (image) | Google AI |
| Gemini 3 Pro (image preview) | Google AI |
| FLUX.1 Dev (Black Forest Labs) | Open-source |
| Stable Diffusion XL Base 1.0 | Open-source |
| Z-Image Turbo | Open-source |
| Qwen Image | Open-source |

We also varied the **text description (caption) used to generate the images**. In addition to the original article caption, we generated synthetic captions using 4 different AI language models and then used those synthetic captions to generate a second set of images. This gives us a two-dimensional picture:

- Does the quality of the caption (description) affect the quality of the generated image?
- Does the choice of image generation model matter more than the caption?

---

## How the Survey Works — Step by Step

### Step 1 — Consent & Language

When you open the survey, you will first see a brief consent screen. You have two options:

- **"Remember Me"** — The survey saves your progress with a 30-day cookie. If you close the browser and return later, you will continue exactly where you left off. You will also be asked a short demographic questionnaire (age, occupation, education level, familiarity with AI, and general stance on AI).

- **"Skip"** — You can participate fully without providing any personal information. No cookie is stored and your session is fully anonymous. You will still be asked the short demographic questionnaire, but because we store no cookie there is no way to recognise you on a future visit — so the questionnaire will appear again in a new session. This is intentional: we keep our promise not to track or identify you across sessions.

Both paths contribute equally valuable data to the study.

You can also select your preferred language from the top of the screen. The full survey interface is available in **English, German, French, and Sinhala**.

> **Note**: All articles are sourced in English. If you choose a non-English language, a notice will remind you that the original content is in English. We encourage completing the survey in English if possible for consistency.

---

### Step 2 — Rating Phase (Stages 1 – 5)

For each of the 100 articles, you will go through **5 rating stages**. Each stage presents a set of images alongside:

- The **article headline and topic**
- A **short AI-generated summary** of the article (accessible via a button)
- The original **full article text** (accessible via a button)
- A **caption** — the text description that was used to generate the images

**Stage 1** shows the **original article caption** alongside **7 images** — the real photograph from the article plus 6 AI-generated versions.

**Stages 2 through 5** each show a different **AI-generated caption** alongside **6 AI-generated images** produced from that caption. The real photograph is not shown in these stages.

For every image in each stage, you rate it on **4 criteria**:

| Criterion | What to Ask Yourself |
|-----------|---------------------|
| ⭐ **Relevance** (1–5) | Does this image feel related to the article's topic? |
| ⭐ **Real-likeness** (1–5) | Does this image look like a real photograph? |
| ⭐ **Accuracy** (1–5) | Does this image accurately reflect what the article describes? |
| 🎚️ **Source Guess** (Real / AI) | Do you think this is a real photograph or AI-generated? |

The images are presented in random order — you will not know in advance which is the real photograph and which are AI-generated. This randomisation is intentional to prevent ordering bias.

The "Next" button becomes available only once all images in the current stage have been fully rated.

---

### Step 3 — Finalization (Stage 6)

After completing all 5 rating stages for an article, you reach the **Finalization Stage**.

The system automatically identifies the **single best-rated image** from each of the 5 stages (based on your Relevance, Real-likeness, and Accuracy ratings — your Source Guess answer is not used here). These 5 finalist images are shown side by side.

Your task is simple: **click the image you consider the single best overall** — the one you would most confidently place next to this article in a real publication.

Once selected, you click "Next" and move on to the next article.

---

### Step 4 — Progress & Gamification

A progress bar at the top of the screen shows how many articles you have completed and which stage you are on. You also earn **points** for correct source guesses (identifying whether an image is real or AI-generated). Points accumulate into a badge tier:

| Points | Badge |
|--------|-------|
| 0 – 19 | 🤖 Getting started |
| 20 – 49 | 🤓 AI Newbie |
| 50 – 99 | 😎 AI Spotter |
| 100 – 199 | 🧐 AI Expert |
| 200 – 299 | 👁️ AI Oracle |
| 300+ | 🏆 Legendary Detector |

This is entirely for engagement — badges have no effect on the data collected.

---

### Step 5 — Leaving the Survey

You can leave the survey at any time using the **"Leave Survey"** button. If you chose "Remember Me" at the start, your progress is fully saved and you can resume from the same point on your next visit.

---

## What Data Is Collected and How Is It Used?

Every response you give — every star rating, every source guess, every finalist selection — is saved to a secure database the moment you make it. Nothing is lost if your browser closes mid-session.

Here is what the database stores:

### Per Rating (every image you rate)
- Which article and which stage
- Which image generation model produced the image
- Which caption model was used (or "original" for the real caption)
- Your star ratings for Relevance, Real-likeness, and Accuracy
- Your source guess (Real / AI)

### Per Article (after finalization)
- Which image you selected as the overall best
- Which stage and model that image came from

### Per Session (optional, "Remember Me" path only)
- Age group, occupation, education level
- Self-reported familiarity with AI tools
- General stance toward AI (Impressed / Neutral / Skeptical)

No names, email addresses, or any other personally identifying information are ever collected.

---

## How the Results Answer the Research Question

When data collection is complete, the ratings will be analysed to answer:

1. **Which image generation model produces images that humans rate as most relevant, realistic, and accurate for news articles?**

2. **Does the quality of the caption (original vs AI-generated, and which AI model) significantly affect how humans perceive the generated image?**

3. **How well can people distinguish real news photographs from AI-generated ones — and does this vary by model, topic, or individual background?**

4. **What combination of caption model + image generation model produces the image most likely to be selected as the overall best by a human viewer?**

The answers will form the empirical foundation of the thesis and contribute to a broader understanding of AI's practical role in visual journalism.

---

## Why a Custom Survey — Not an Existing Tool?

Tools like Google Forms, SurveyMonkey, or Qualtrics are excellent for general-purpose questionnaires. This survey has requirements they cannot meet:

| Requirement | Off-the-shelf Tools | This Survey |
|-------------|-------------------|-------------|
| Show randomised sets of images per participant | ❌ Not supported | ✅ Seeded randomisation per session |
| 100 articles × 6 stages × up to 7 images | ❌ Prohibitive to build | ✅ Automated from metadata |
| Resume interrupted session mid-article | ❌ Not available | ✅ Exact stage + article restored |
| Track which AI model produced each rated image | ❌ Not possible | ✅ Stored per rating record |
| Multi-language interface (EN/DE/FR/SI) | ⚠️ Limited/paid | ✅ Full translation, instant switching |
| Intelligent article assignment across participants | ❌ Not possible | ✅ 3-phase balancing algorithm |
| Export structured data directly for thesis analysis | ⚠️ Generic CSV only | ✅ Relational database, model-level granularity |
| No per-response or per-participant fees | ❌ Often per-response pricing | ✅ Self-hosted, zero cost per participant |

The core advantage is **data granularity**. Every rating is linked to the exact AI model and caption that produced the image. This makes it possible to run rigorous model-level comparisons — something no off-the-shelf tool could provide without months of custom workarounds.

---

## For Participants — What to Expect

| | |
|--|--|
| **Time per article** | ~5–10 minutes |
| **Total time (all 100 articles)** | Spread across multiple sessions |
| **No right or wrong answers** | Your honest perception is the data |
| **No AI knowledge required** | You are evaluating images as a viewer, not as a technical expert |
| **You can stop and return** | "Remember Me" saves your exact position |

---

## Thank You

This survey only works because of the time and attention of its participants. Every rating you submit directly contributes to an empirical evaluation of where AI image generation currently stands — and where it still falls short.

If you have questions about the survey or the research, please reach out directly.

---

*Survey built for thesis research, May 2026.*  
*Data stored locally; not shared with any third parties.*

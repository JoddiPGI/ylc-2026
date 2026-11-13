import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Plan, PM, Q } from '../types'

const IDLE: PM = {
  phase: 'idle',
  original: '',
  status: '',
  goal: '',
  questions: [],
  answers: [],
  plan: null,
  saved: '',
  error: '',
}
const pm = atom({ plugin: 'prompt-master', key: 'pm' } as const, IDLE, {
  shape: 'pm-1',
})

const ANALYZE = `You are the first step of "Prompt Master", which improves a person's rough prompt.
Read the rough prompt. Work out what they want to get done. Then decide which of these three things are NOT already clear from the prompt:
- audience: who it is for, or where it will be used
- great: what a great result looks like (an example, a tone, a goal)
- format: the format and length wanted
Ask only about what is missing and matters. If the prompt already answers all three, ask nothing. At most 3 questions, in the order above.
For each question give 3 or 4 short, plausible answer options tailored to THIS prompt (each under 7 words).
Reply with JSON only, no prose, no code fence:
{"goal":"one sentence on what they are trying to get done","questions":[{"id":"audience|great|format","ask":"short question","options":["...","..."]}]}`

const OPTIMIZE = `You are Prompt Master. Turn the person's rough prompt into a better prompt, and advise which AI tool and Claude model fit.

RULES
- Keep their meaning and their own words wherever those already work.
- NEVER invent facts about the person, their business, or numbers. Anything still unknown is written exactly as [fill this in: what is needed].
- Use their answers to the clarifying questions as Context. A skipped question is simply unknown; do not guess it.

BEST TOOL: choose exactly one of: Claude, ChatGPT, Gemini, Image generator, Video generator. Pick by the task (writing/reasoning/code/long documents -> Claude; broad general chat, quick brainstorm, data analysis with its code tool -> ChatGPT; very long inputs, Google Workspace or live web/multimodal -> Gemini; a picture -> Image generator; moving footage -> Video generator). Say why in one sentence.

WRITE THE "prompt" THE WAY THAT TOOL WORKS BEST
- Claude: sections Role, Task, Context, Format, Quality check (plain labelled sections or simple XML-style tags). Put long material before the question.
- ChatGPT: same five sections, with clear delimiters and an explicit step order; state the output format precisely.
- Gemini: same five sections, direct imperative sentences, the format spelled out, any source material first.
- Image generator: NOT the five sections. One descriptive prompt: subject, setting, style/medium, lighting, composition/camera, colour palette, mood, aspect ratio, and a short "avoid:" list.
- Video generator: NOT the five sections. Subject, action in time order or shot by shot, camera movement, style, lighting, duration, aspect ratio, and a short "avoid:" list.
For text tools the prompt must contain these five labelled parts: Role (who the AI acts as), Task (one or two clear sentences), Context (who it is for, details that matter, their answers), Format (length, structure, tone), Quality check (what to double-check before answering).

CLAUDE MODEL AND EFFORT (always fill in, even if the best tool is another one, as the Claude option): pick the SMALLEST that will do the job well. Models: Haiku 5.5 (simple, short, formatting, extraction, quick rewrites), Sonnet 5.5 (most writing, analysis, coding, planning), Opus 5.5 (hard multi-step reasoning, large careful work), Fable 5.2 (only the hardest, highest-stakes problems). Effort: low, medium, high, xhigh or max; default to low or medium and raise only for real difficulty. Do not reach for Fable or Sonnet by habit.

MULTI-TOOL: set isMulti true only when two or more tools together clearly give a better result than one (for example Claude writes the script, an image generator makes the visuals, a video generator animates). Then give "steps" in order, each with the tool, its own ready-to-paste prompt written for that tool, and what it produces for the next step. Also write "handoff", a Markdown file titled "Handoff", with: goal, shared context (audience, tone, facts known, [fill this in] gaps), a numbered pipeline (tool, input, output, file or text to pass on), consistency rules every tool must follow (names, style, palette, length), and a final checklist. If isMulti is false, steps is [] and handoff is "".

"note": one short line on what you changed and why.

Reply with JSON only, no prose, no code fence:
{"prompt":"...","note":"...","tool":"...","toolWhy":"...","claudeModel":"...","claudeEffort":"...","claudeWhy":"...","isMulti":false,"steps":[{"tool":"...","prompt":"...","produces":"..."}],"handoff":""}`

const parse = (text: string): Record<string, unknown> | null => {
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    return JSON.parse(text.slice(a, b + 1))
  } catch {
    return null
  }
}
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)

let running = false

async function optimize($: EngineInterface) {
  const s = await read($, pm)
  await update($, pm, v => ({
    ...v,
    phase: 'working',
    status: 'Writing your better prompt...',
  }))
  const given = s.answers.length
    ? s.answers.map(a => `- ${a.ask} -> ${a.answer}`).join('\n')
    : '(none)'
  const r = await $.model.complete({
    model: 'sonnet',
    effort: 'medium',
    maxTokens: 6000,
    system: OPTIMIZE,
    prompt: `ROUGH PROMPT:\n${s.original}\n\nWHAT THEY WANT TO GET DONE: ${s.goal}\n\nANSWERS (skipped ones are unknown):\n${given}`,
  })
  const j = r.isAnswered ? parse(r.text) : null
  if (!j || !str(j.prompt)) {
    await update($, pm, () => ({
      ...IDLE,
      error: 'Prompt Master could not write the prompt. Try again.',
    }))
    running = false
    return
  }
  const steps = Array.isArray(j.steps)
    ? (j.steps as Record<string, unknown>[]).map(x => ({
        tool: str(x.tool),
        prompt: str(x.prompt),
        produces: str(x.produces),
      }))
    : []
  const plan: Plan = {
    prompt: str(j.prompt),
    note: str(j.note),
    tool: str(j.tool, 'Claude'),
    toolWhy: str(j.toolWhy),
    claudeModel: str(j.claudeModel),
    claudeEffort: str(j.claudeEffort),
    claudeWhy: str(j.claudeWhy),
    isMulti: j.isMulti === true && steps.length > 1,
    steps,
    handoff: str(j.handoff),
  }
  await update($, pm, v => ({ ...v, phase: 'result', plan, status: '' }))
  running = false
}

async function start($: EngineInterface, raw: string) {
  const text = raw.trim()
  if (running) return
  if (!text) {
    $.ui.toast('Type a rough prompt first, then click ✦ Prompt Master.')
    return
  }
  running = true
  await update($, pm, () => ({
    ...IDLE,
    phase: 'working',
    original: text,
    status: 'Reading your prompt...',
  }))
  const r = await $.model.complete({
    model: 'sonnet',
    effort: 'low',
    maxTokens: 1500,
    system: ANALYZE,
    prompt: `ROUGH PROMPT:\n${text}`,
  })
  const j = r.isAnswered ? parse(r.text) : null
  const qs: Q[] = Array.isArray(j?.questions)
    ? (j.questions as Record<string, unknown>[]).slice(0, 3).map(q => ({
        id: str(q.id),
        ask: str(q.ask),
        options: Array.isArray(q.options)
          ? (q.options as unknown[]).map(o => str(o)).filter(Boolean).slice(0, 4)
          : [],
      }))
    : []
  const goal = str(j?.goal, text)
  await update($, pm, v => ({ ...v, goal, questions: qs.filter(q => q.ask) }))
  const now = await read($, pm)
  if (now.questions.length === 0) {
    await optimize($)
  } else {
    await update($, pm, v => ({ ...v, phase: 'asking', status: '' }))
    running = false
  }
}

async function answer($: EngineInterface, text: string) {
  const s = await read($, pm)
  const q = s.questions[s.answers.length]
  if (!q) return
  const given = text.trim()
  const answers = given ? [...s.answers, { ask: q.ask, answer: given }] : s.answers
  // A skip still advances: track position with a placeholder-free counter.
  const asked = s.questions.slice(1)
  await update($, pm, v => ({ ...v, answers, questions: asked }))
  if (asked.length === 0) {
    running = true
    await optimize($)
  }
}

function close($: EngineInterface) {
  running = false
  return update($, pm, () => IDLE)
}

async function save($: EngineInterface, plan: Plan) {
  const dir = 'prompt-master'
  await $.fs.write(`${dir}/handoff.md`, plan.handoff)
  let n = 0
  for (const s of plan.steps) {
    n += 1
    const slug = s.tool.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    await $.fs.write(
      `${dir}/step-${n}-${slug}.md`,
      `# Step ${n}: ${s.tool}\n\nProduces: ${s.produces}\n\n## Prompt\n\n${s.prompt}\n`,
    )
  }
  await update($, pm, v => ({
    ...v,
    saved: `Saved ${dir}/handoff.md and ${n} step prompt file(s) in the project folder.`,
  }))
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prompt-master',
      description: 'Improve your rough prompt before you send it',
      argumentHint: '[rough prompt]',
    })
    return next(e)
  })

  // "/prompt-master <prompt>" typed in the box: never sent, always intercepted.
  on('prompt.submit', async ($, e, next) => {
    const m = /^\s*\/prompt-master\b\s*([\s\S]*)$/i.exec(e.text)
    if (!m) return next(e)
    void start($, m[1]!)
    return { drop: 'Prompt Master is reading your prompt (nothing was sent)...' }
  })

  on('command.run', { command: 'prompt-master' }, async ($, e) => {
    const draft = e.args.trim() || (await $.prompt.read()).text
    void start($, draft)
    return { text: 'Prompt Master is reading your prompt. Nothing is sent.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const s = await read($, pm)
    const { Box, Text, Button, Input } = $.ui.resolve(e)

    if (s.phase === 'idle') {
      return (
        <Box>
          <Button
            key="go"
            label="✦ Prompt Master"
            onPress={async () => start($, (await $.prompt.read()).text)}
          />
          {s.error ? <Text color="red"> {s.error}</Text> : null}
        </Box>
      )
    }

    if (s.phase === 'working') {
      return (
        <Box>
          <Text>✦ {s.status}</Text>
        </Box>
      )
    }

    if (s.phase === 'asking') {
      const q = s.questions[0]!
      return (
        <Box flexDirection="column">
          <Text bold>
            ✦ Question (about {s.questions.length} left): {q.ask}
          </Text>
          <Box>
            {q.options.map((o, i) => (
              <Button key={`o${i}`} label={o} onPress={() => answer($, o)} />
            ))}
            <Button key="skip" label="Skip" onPress={() => answer($, '')} />
          </Box>
          <Input
            key="own"
            placeholder="Or type your own answer and press Enter"
            onSubmit={v => answer($, v)}
          />
        </Box>
      )
    }

    const plan = s.plan!
    if (s.phase === 'editing') {
      return (
        <Box flexDirection="column">
          <Text bold>✦ Edit, then press Enter to put it in your prompt box</Text>
          <Input
            key="edit"
            rows={10}
            value={plan.prompt}
            autoFocus
            submitLabel="use"
            onSubmit={async v => {
              await $.prompt.fill({ text: v })
              await close($)
            }}
          />
          <Button key="cancel" label="Cancel" onPress={() => close($)} />
        </Box>
      )
    }

    // result
    return (
      <Box flexDirection="column">
        <Text bold>✦ Better prompt (for {plan.tool})</Text>
        <Text>{plan.prompt}</Text>
        <Text dimColor>Changed: {plan.note}</Text>
        <Text dimColor>Best tool: {plan.tool}. {plan.toolWhy}</Text>
        <Text dimColor>
          If Claude: {plan.claudeModel}, effort {plan.claudeEffort}. {plan.claudeWhy}
        </Text>
        {plan.isMulti && (
          <Box flexDirection="column">
            <Text bold>Best with several tools together:</Text>
            {plan.steps.map((st, i) => (
              <Text>
                {i + 1}. {st.tool} → {st.produces}
              </Text>
            ))}
            <Button key="save" label="Save handoff.md + step prompts" onPress={() => save($, plan)} />
            {s.saved ? <Text color="green">{s.saved}</Text> : null}
          </Box>
        )}
        <Text dimColor>Your original: {s.original}</Text>
        <Box>
          <Button
            key="use"
            label="Use this"
            onPress={async () => {
              await $.prompt.fill({ text: plan.prompt })
              await close($)
              $.ui.toast('Placed in your prompt box. Press send when ready.')
            }}
          />
          <Button
            key="edit"
            label="Edit"
            onPress={() => update($, pm, v => ({ ...v, phase: 'editing' }))}
          />
          <Button key="keep" label="Keep mine" onPress={() => close($)} />
        </Box>
      </Box>
    )
  })
}

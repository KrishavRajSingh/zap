import type { ElementCandidate } from "~lib/agent/types"

const tokenize = (value: string) => {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)
}

export const rankCandidates = (
  candidates: ElementCandidate[],
  command: string,
  maxCount: number
) => {
  const tokens = tokenize(command)
  const commandLower = command.toLowerCase()
  const typingIntent =
    /\b(type|enter|fill|input|write|search|formula|cell)\b/.test(commandLower)
  const clickIntent = /\b(click|open|select|tap|press)\b/.test(commandLower)
  const formIntent =
    /\b(form|application|apply|profile|register|signup|sign up|submit)\b/.test(
      commandLower
    )

  const scored = candidates.map((candidate) => {
    const haystack = [
      candidate.text,
      candidate.label,
      candidate.placeholder,
      candidate.valuePreview,
      candidate.questionText,
      candidate.describedBy,
      candidate.nameAttr,
      candidate.idAttr,
      candidate.autocomplete,
      candidate.href,
      candidate.context,
      candidate.tagName,
      candidate.inputType ?? "",
      candidate.role ?? ""
    ]
      .join(" ")
      .toLowerCase()

    const isButtonLike =
      candidate.tagName === "button" ||
      candidate.role === "button" ||
      candidate.tagName === "a"
    const isEditable =
      candidate.tagName === "input" ||
      candidate.tagName === "textarea" ||
      candidate.tagName === "select" ||
      candidate.role === "textbox" ||
      candidate.inputType !== null

    let score = 0

    for (const token of tokens) {
      if (haystack.includes(token)) {
        score += 4
      }
    }

    if (candidate.inViewport) {
      score += 1
    } else {
      score -= 1
    }

    if (candidate.visible) {
      score += 2
    } else {
      score -= 6
    }

    if (!candidate.enabled) {
      score -= 6
    }

    if (candidate.rect.width <= 2 || candidate.rect.height <= 2) {
      score -= 5
    }

    if (isButtonLike) {
      score += 1
    }

    if (typingIntent && isEditable) {
      score += 3
    }

    if (typingIntent && !isEditable) {
      score -= 2
    }

    if (formIntent && isEditable) {
      score += 2
    }

    if (candidate.required && isEditable) {
      score += 1
    }

    if (candidate.label || candidate.questionText || candidate.placeholder) {
      score += 1
    }

    if (candidate.inputType === "file") {
      score -= 8
    }

    if (clickIntent && isButtonLike) {
      score += 2
    }

    return {
      candidate,
      score
    }
  })

  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, maxCount).map((item) => item.candidate)
}

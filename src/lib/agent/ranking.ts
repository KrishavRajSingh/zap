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

  const scored = candidates.map((candidate) => {
    const haystack = [
      candidate.text,
      candidate.label,
      candidate.placeholder,
      candidate.href,
      candidate.context,
      candidate.tagName,
      candidate.role ?? ""
    ]
      .join(" ")
      .toLowerCase()

    let score = 0

    for (const token of tokens) {
      if (haystack.includes(token)) {
        score += 4
      }
    }

    if (candidate.inViewport) {
      score += 1
    }

    if (candidate.visible) {
      score += 1
    }

    if (!candidate.enabled) {
      score -= 2
    }

    if (candidate.tagName === "button" || candidate.role === "button") {
      score += 1
    }

    return {
      candidate,
      score
    }
  })

  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, maxCount).map((item) => item.candidate)
}

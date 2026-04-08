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
  const searchIntent =
    /\b(search|find|look up|lookup|query|song|video|youtube)\b/.test(
      commandLower
    )
  const clearIntent =
    /\b(clear|reset|erase|empty|remove|wipe|blank out)\b/.test(commandLower)
  const fillIntent =
    /\b(fill|complete|populate|finish|submit|application|form)\b/.test(
      commandLower
    )
  const fillAllIntent =
    /\b(rest|remaining|all|entire)\b/.test(commandLower) ||
    /\bfill (?:this|the) form\b/.test(commandLower)
  const clickIntent = /\b(click|open|select|tap|press)\b/.test(commandLower)
  const formIntent =
    /\b(form|application|apply|profile|register|signup|sign up|submit)\b/.test(
      commandLower
    )
  const hasSearchFieldCandidate = candidates.some((candidate) => {
    const descriptor = [
      candidate.label,
      candidate.placeholder,
      candidate.nameAttr,
      candidate.idAttr,
      candidate.autocomplete,
      candidate.role ?? "",
      candidate.text,
      candidate.questionText,
      candidate.context
    ]
      .join(" ")
      .toLowerCase()

    return (
      candidate.enabled &&
      candidate.visible &&
      candidate.allowsTextEntry &&
      /\b(search|searchbox|search_query|query|find)\b/.test(descriptor)
    )
  })

  const isOptionOwnedByAnsweredControl = (candidate: ElementCandidate) => {
    if (candidate.controlKind !== "select_option") {
      return false
    }

    const matchingOwner = candidates.find((item) => {
      if (
        item.controlKind !== "custom_select" &&
        item.controlKind !== "native_select"
      ) {
        return false
      }

      if (
        item.frameId !== candidate.frameId ||
        item.frameUrl !== candidate.frameUrl
      ) {
        return false
      }

      if (
        candidate.ownerControlSelector &&
        item.ownerControlSelector === candidate.ownerControlSelector
      ) {
        return true
      }

      const itemSelector = item.interactionSelector || item.selector
      return (
        candidate.ownerControlSelector.length > 0 &&
        itemSelector === candidate.ownerControlSelector
      )
    })

    if (matchingOwner) {
      return matchingOwner.valuePreview.trim().length > 0
    }

    return false
  }

  const scored = candidates.map((candidate) => {
    const haystack = [
      candidate.controlKind,
      candidate.popupState,
      candidate.optionSource ?? "",
      candidate.frameTitle,
      candidate.frameUrl,
      candidate.text,
      candidate.label,
      candidate.placeholder,
      candidate.valuePreview,
      candidate.questionText,
      candidate.describedBy,
      candidate.nameAttr,
      candidate.idAttr,
      candidate.forAttr,
      candidate.autocomplete,
      candidate.href,
      candidate.context,
      candidate.tagName,
      candidate.inputType ?? "",
      candidate.role ?? "",
      candidate.checked === true
        ? "checked selected true yes"
        : candidate.checked === false
          ? "unchecked unselected false no"
          : ""
    ]
      .join(" ")
      .toLowerCase()

    const isButtonLike =
      candidate.tagName === "button" ||
      candidate.role === "button" ||
      candidate.controlKind === "select_option" ||
      candidate.tagName === "a"
    const isEditable =
      candidate.controlKind === "custom_select" ||
      candidate.tagName === "input" ||
      candidate.tagName === "textarea" ||
      candidate.tagName === "select" ||
      candidate.role === "textbox" ||
      (candidate.inputType !== null &&
        candidate.controlKind !== "select_option")
    const isChoiceControl =
      candidate.inputType === "checkbox" ||
      candidate.inputType === "radio" ||
      candidate.role === "checkbox" ||
      candidate.role === "radio"
    const isSelectOption = candidate.controlKind === "select_option"
    const isCustomSelect = candidate.controlKind === "custom_select"
    const isPickerLikeCustomSelect =
      candidate.controlKind === "custom_select" && !candidate.allowsTextEntry
    const isSearchField =
      candidate.allowsTextEntry &&
      /\b(search|searchbox|search_query|query|find)\b/.test(haystack)
    const isSearchSubmitButton =
      isButtonLike && /\b(search|submit|go)\b/.test(haystack)
    const hasValue = candidate.valuePreview.trim().length > 0
    const isSelected = candidate.checked === true
    const isLabelOption =
      candidate.tagName === "label" &&
      candidate.forAttr.length > 0 &&
      /\b(yes|no|true|false)\b/.test(candidate.text.toLowerCase())
    const optionOwnedByAnsweredControl =
      isOptionOwnedByAnsweredControl(candidate)

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

    if (searchIntent && isSearchField) {
      score += 6
    }

    if (searchIntent && isSearchSubmitButton) {
      score += 1
    }

    if (searchIntent && isSearchSubmitButton && hasSearchFieldCandidate) {
      score -= 2
    }

    if (typingIntent && !isEditable) {
      score -= 2
    }

    if (typingIntent && isPickerLikeCustomSelect) {
      score -= 1
    }

    if (!clearIntent && fillIntent && isEditable && hasValue) {
      score -= 5
    }

    if (!clearIntent && fillIntent && isCustomSelect && hasValue) {
      score -= 8
    }

    if (!clearIntent && fillIntent && isChoiceControl && isSelected) {
      score -= 5
    }

    if (fillAllIntent && isEditable && !hasValue) {
      score += candidate.required ? 3 : 1
    }

    if (fillAllIntent && isChoiceControl && !isSelected) {
      score += candidate.required ? 3 : 1
    }

    if (clearIntent && isEditable) {
      score += hasValue ? 7 : -6
    }

    if (clearIntent && isCustomSelect) {
      score += hasValue ? 4 : -5
    }

    if (clearIntent && isChoiceControl) {
      score += isSelected ? 6 : -5
    }

    if (
      clearIntent &&
      isButtonLike &&
      /\b(clear|reset|remove|erase)\b/.test(haystack)
    ) {
      score += 6
    }

    if (formIntent && isEditable) {
      score += 2
    }

    if (candidate.frameId !== 0 && isEditable) {
      score += 2
    }

    if (isCustomSelect) {
      score += 2
    }

    if (formIntent && (isChoiceControl || isLabelOption)) {
      score += 3
    }

    if (isSelectOption && candidate.visible) {
      score += 4
    }

    if (isSelectOption && candidate.inViewport) {
      score += 2
    }

    if (candidate.popupState === "open" && isSelectOption) {
      score += 3
    }

    if (fillIntent && isSelectOption && optionOwnedByAnsweredControl) {
      score -= 12
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

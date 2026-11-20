// Shared placement for the paper cards that slide out beside a closeup (cottage redesign option D2).
// Wide screens: the object sits in the left part of the view and the card to its right.
// Narrow screens: the object sits in the upper part and the card becomes a sheet below it.
// A thin thread runs from the object to the card.

export const COMPACT_WIDTH = 575
const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high))

// Camera offsets (in world units at the target plane) that move the object out of the card's way.
export function cardFraming(span, aspect, compact) {
  return compact ? { midX: 0, midY: -span * .23 } : { midX: span * aspect * .22, midY: 0 }
}

// How large (pixels per world unit) an object of the given size may appear beside a card.
export function cardScale(width, height, viewportWidth, viewportHeight, limit) {
  return viewportWidth < COMPACT_WIDTH
    ? Math.min((viewportWidth - 40) / width, viewportHeight * .4 / height, limit)
    : Math.min((viewportWidth * .5 - 36) / width, (viewportHeight - 130) / height, limit)
}

// side: the object's right edge on wide screens; bottom: its lower edge on narrow ones (both in pixels).
export function placeCard(card, thread, { side, bottom, compact, width, height }) {
  card.dataset.compact = String(compact)
  let endX
  let endY
  if (compact) {
    const top = clamp(bottom.y + 22, height * .38, height - 170)
    card.style.setProperty("--card-left", "12px")
    card.style.setProperty("--card-top", `${top}px`)
    card.style.setProperty("--card-width", `${width - 24}px`)
    card.style.setProperty("--card-max", `${height - top - 12}px`)
    endX = clamp(bottom.x, 40, width - 40)
    endY = top
    thread.style.left = `${bottom.x}px`
    thread.style.top = `${bottom.y}px`
    endX -= bottom.x
    endY -= bottom.y
  } else {
    const left = clamp(side.x + 44, 12, width - 280)
    const cardWidth = Math.min(380, width - left - 20)
    card.style.setProperty("--card-left", `${left}px`)
    card.style.setProperty("--card-width", `${cardWidth}px`)
    card.style.setProperty("--card-max", `${height - 84}px`)
    const cardHeight = card.offsetHeight || 220
    const top = clamp(side.y - cardHeight / 2, 60, height - cardHeight - 24)
    card.style.setProperty("--card-top", `${top}px`)
    endX = left - side.x
    endY = clamp(side.y, top + 22, top + cardHeight - 22) - side.y
    thread.style.left = `${side.x}px`
    thread.style.top = `${side.y}px`
  }
  thread.style.width = `${Math.hypot(endX, endY)}px`
  thread.style.rotate = `${Math.atan2(endY, endX)}rad`
}

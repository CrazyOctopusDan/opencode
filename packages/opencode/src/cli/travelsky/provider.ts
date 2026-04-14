export function isTravelSky(input: string | undefined) {
  if (!input) return false
  return input.trim().toLowerCase() === "travelsky"
}


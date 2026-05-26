export function isTravelSky(input: string | undefined) {
  if (!input) return false
  return input.trim().toLowerCase() === "travelsky"
}

export function travelSkyProviderID(input: {
  provider?: Array<{ id?: string }>
  providerNext?: Array<{ id?: string }>
}) {
  return (
    input.provider?.find((item) => isTravelSky(item.id))?.id ??
    input.providerNext?.find((item) => isTravelSky(item.id))?.id ??
    "travelSky"
  )
}

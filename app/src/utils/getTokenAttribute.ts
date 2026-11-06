type Attribute = {
  trait_type: string
  value: string
}

/** The trait's value, or '' when the token doesn't have it, so nothing ever prints "undefined". */
export function getTokenAttribute(attributes: Attribute[], attribute: string): string {
  return attributes.find((item) => item.trait_type === attribute)?.value ?? ''
}

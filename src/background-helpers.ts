export function isDefaultBackgroundValue(property: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return true;
  switch (property) {
    case "background-image":
      return v === "none";
    case "background-position":
      return v === "0% 0%" || v === "0px 0px";
    case "background-size":
      return v === "auto" || v === "auto auto";
    case "background-repeat":
      return v === "repeat" || v === "repeat repeat";
    default:
      return false;
  }
}

export function shouldShowBackgroundRow(
  property: string,
  value: string,
  hasDeclaration: boolean,
): boolean {
  if (property === "background") return false;
  if (["background-image", "background-position", "background-size", "background-repeat"].includes(property)) {
    if (hasDeclaration) return true;
    return !isDefaultBackgroundValue(property, value);
  }
  return true;
}

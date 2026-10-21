// Stand-in for next/dynamic. Lazily loaded panels are never part of a shot, so the loader yields an empty component.
export default function dynamic() {
  const Empty = () => null;
  return Empty;
}

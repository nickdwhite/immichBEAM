export function Logo({
  size = 32,
  className = "",
  title = "immichBEAM",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <img
      src="/logo-circular.png"
      width={size}
      height={size}
      alt={title}
      className={className}
      draggable={false}
    />
  );
}

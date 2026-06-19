interface Props {
  size?: number;
  className?: string;
}

export default function MedicalCrossLogo({ size = 36, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="50" cy="50" r="44" stroke="#DC2626" strokeWidth="7" />
      <rect x="37" y="20" width="26" height="60" rx="5" fill="#DC2626" />
      <rect x="20" y="37" width="60" height="26" rx="5" fill="#DC2626" />
    </svg>
  );
}

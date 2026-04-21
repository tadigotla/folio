interface Props {
  thick?: boolean;
  className?: string;
}

export function Rule({ thick = false, className = '' }: Props) {
  return (
    <hr
      className={`border-0 bg-rule ${thick ? 'h-0.5' : 'h-px'} ${className}`}
    />
  );
}

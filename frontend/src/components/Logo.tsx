import { cn } from "@/utils/cn";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 no-underline", className)}>
      <img src="/quantapool.svg" alt="" className="h-7 w-7" />
      <span className="text-lg font-black italic tracking-tight">
        <span className="text-foreground">QUANTA</span>
        <span className="text-secondary">POOL</span>
      </span>
    </span>
  );
}

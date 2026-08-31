import { CheckCircle2, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The "verified vs. not disclosed" two-column view HANDOFF.md section 12.1 /
 * scene 4 of the demo script builds around. This is the single most
 * important UI moment in the product: it is how a non-technical viewer sees
 * that a real check happened without their private data leaving their side.
 */
export function DisclosurePanel({
  verified,
  notDisclosed,
}: {
  verified: string[];
  notDisclosed: string[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="border-emerald-500/40">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-base">
            <CheckCircle2 className="size-4" />
            Verified
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-sm">
            {verified.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card className="border-muted-foreground/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-muted-foreground text-base">
            <EyeOff className="size-4" />
            Not disclosed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {notDisclosed.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <EyeOff className="mt-0.5 size-3.5 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

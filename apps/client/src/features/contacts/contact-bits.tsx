import { UserRound } from "lucide-react";
import { type ReactNode } from "react";

import { FormInput as InputField, FormNativeSelect as SelectInput } from "@/components/app-ui";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { type Contact } from "@kaenma/shared/contacts";

export type BulkAction =
  | "add_tag"
  | "remove_tag"
  | "add_list"
  | "remove_list"
  | "archive"
  | "restore";

export function ControlledSelect({
  value,
  onValueChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  className?: string;
}): ReactNode {
  return (
    <Select
      items={options}
      value={value || null}
      onValueChange={(nextValue) => onValueChange(nextValue ?? "")}
    >
      <SelectTrigger className={cn("min-w-40", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="">{placeholder}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function ContactAvatar({
  contact,
  large = false,
}: {
  contact: Contact;
  large?: boolean;
}): ReactNode {
  const initials = [contact.firstName, contact.lastName]
    .filter(Boolean)
    .map((value) => value!.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <Avatar size={large ? "lg" : "default"} className={cn(large && "size-14")}>
      <AvatarFallback className={cn(large && "text-lg")}>
        {initials || <UserRound />}
      </AvatarFallback>
    </Avatar>
  );
}

export function ContactStatusBadge({ status }: { status: Contact["status"] }): ReactNode {
  const classes = (
    {
      active: "bg-success text-success-foreground",
      archived: "",
      anonymous: "bg-warning text-warning-foreground",
    } satisfies Record<Contact["status"], string>
  )[status];
  const label = { active: "有効", archived: "アーカイブ", anonymous: "匿名" }[status];
  return (
    <Badge variant="secondary" className={classes}>
      {label}
    </Badge>
  );
}

export function ColorChip({ item }: { item: { name: string; color: string } }): ReactNode {
  return (
    <Badge variant="secondary" className="gap-1">
      <span className="size-1.5 rounded-full" style={{ backgroundColor: item.color }} />
      {item.name}
    </Badge>
  );
}

export function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: ReactNode;
}): ReactNode {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          {icon}
          {label}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}): ReactNode {
  return (
    <SelectInput
      label={label}
      name={`filter-${label}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </SelectInput>
  );
}

export function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}): ReactNode {
  return (
    <InputField
      label={label}
      name={`filter-${label}`}
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function contactName(contact: Contact): string {
  return (
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    contact.email ||
    contact.externalId ||
    "匿名Contact"
  );
}

export function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .slice(0, 100) || `segment-${Date.now()}`
  );
}

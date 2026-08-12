import { ModuleLayout } from "@/components/shell/ModuleLayout";

export default function ClientsLayout({ children }: LayoutProps<"/clients">) {
  return <ModuleLayout>{children}</ModuleLayout>;
}

import { ModuleLayout } from "@/components/shell/ModuleLayout";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <ModuleLayout>{children}</ModuleLayout>;
}

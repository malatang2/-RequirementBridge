"use client";

import { useState } from "react";
import { RequirementsCreateDialog } from "@/components/dashboard/requirements-create-dialog";

/** 列表页"新建需求"按钮 + 对话框触发器（客户端，因需切换 dialog 状态） */
export function RequirementNewButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        + 新建需求
      </button>
      <RequirementsCreateDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

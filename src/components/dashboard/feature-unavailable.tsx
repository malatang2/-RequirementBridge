/**
 * 灰度关闭时的模块占位（09 工单）。
 * flag off 用户直链访问 gated 页面（如 /dashboard/requirements）时渲染，
 * 与侧栏入口隐藏、server action 二次校验共同构成三层 gate 的展示层。
 */
export function FeatureUnavailable() {
  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-dashed border-border p-12 text-center">
      <p className="text-sm font-semibold">功能尚未开放</p>
      <p className="mt-2 text-xs text-muted-foreground">
        该功能正在灰度发布中，暂未对你开放，敬请期待。
      </p>
    </div>
  );
}

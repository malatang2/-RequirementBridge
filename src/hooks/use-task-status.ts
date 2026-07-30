"use client";

/**
 * 任务状态轮询 Hook（T0.6 / Follow-up F10）。
 * 对应《前后端接口契约》status 状态机 + 《设计评审清单 F10》规范：
 * - 组件卸载/路由切走时停轮询（防内存泄漏）
 * - 浏览器后台 tab 降频/暂停（visibilitychange）
 * - 轮询到 completed/failed 终止
 * - 指数退避，防 status 长期不变时的请求风暴
 * - 超时兜底：N 分钟仍 in-flight → 提示失败（双保险防僵尸态，呼应 A2.3 超时落 failed）
 *
 * 三模块（会议/API/反馈）复用此 hook。
 */

import { useEffect, useRef, useState } from "react";
import type { TaskStatus, GenStatus } from "@/types/database";

/** 任意状态类型（会议/反馈用 TaskStatus，API 用 GenStatus），都含 completed/failed 终态 */
type AnyStatus = TaskStatus | GenStatus;

const TERMINAL_STATES: AnyStatus[] = ["completed", "failed"];
const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟无更新视为僵尸态

interface UseTaskStatusOptions<S extends AnyStatus> {
  /** 轮询取最新 status 的函数，返回 { status, updatedAt } */
  fetcher: () => Promise<{ status: S; updatedAt: string }>;
  /** 是否启用轮询（终态自动停） */
  enabled: boolean;
  /** 初始状态 */
  initialStatus: S;
  /** 轮询基础间隔（ms），默认 2000（接口契约 API-3：2s 一次） */
  intervalMs?: number;
}

export function useTaskStatus<S extends AnyStatus>({
  fetcher,
  enabled,
  initialStatus,
  intervalMs = 2000,
}: UseTaskStatusOptions<S>) {
  const [status, setStatus] = useState<S>(initialStatus);
  const [isStale, setIsStale] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(intervalMs);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!enabled || TERMINAL_STATES.includes(status)) return;

    let lastUpdatedAt: string | null = null;

    const poll = async () => {
      if (!mountedRef.current) return;
      // 后台 tab 暂停轮询
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        scheduleNext(intervalMs);
        return;
      }

      try {
        const result = await fetcher();
        if (!mountedRef.current) return;

        // 僵尸态检测：updated_at 长时间未变
        if (lastUpdatedAt && result.updatedAt === lastUpdatedAt) {
          const staleSince = new Date(result.updatedAt).getTime();
          if (Date.now() - staleSince > STALE_TIMEOUT_MS) {
            setIsStale(true);
            setStatus("failed" as S);
            return;
          }
        }
        lastUpdatedAt = result.updatedAt;

        setStatus(result.status);
        if (TERMINAL_STATES.includes(result.status)) return; // 终态停止

        backoffRef.current = intervalMs; // 有进展，重置退避
      } catch {
        // 轮询本身失败：指数退避，不直接置 failed（网络抖动可恢复）
        backoffRef.current = Math.min(backoffRef.current * 1.5, 10_000);
      }
      scheduleNext(backoffRef.current);
    };

    const scheduleNext = (delay: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(poll, delay);
    };

    scheduleNext(intervalMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, status]);

  return { status, isStale };
}

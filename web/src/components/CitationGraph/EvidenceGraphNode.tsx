import {
  GitBranch,
  CheckCircle2,
  XCircle,
  Target,
  Hash,
  ChevronRight,
  ChevronDown as ChevronDownIcon,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GraphNode } from './types';
import { SourceIcon } from './SourceIcon';
import { VERDICT_CONFIG } from './verdictConfig';

interface EvidenceGraphNodeProps {
  node: GraphNode;
  level?: number;
  isLast?: boolean;
  onExpand?: (id: string) => void;
  expandedNodes?: Set<string>;
}

function getNodeStyles(
  status: GraphNode['status'],
  isRoot: boolean,
  nodeType?: GraphNode['type'],
  verdictLabel?: GraphNode['verdictLabel'],
): string {
  if (isRoot) {
    return 'border-indigo-300/90 bg-indigo-50/70 dark:border-indigo-800 dark:bg-indigo-950/60 shadow-2xs';
  }
  switch (status) {
    case 'success':
      return 'border-emerald-200/90 bg-emerald-50/60 dark:border-emerald-800/80 dark:bg-emerald-950/40';
    case 'warning':
      return 'border-amber-200/90 bg-amber-50/60 dark:border-amber-800/80 dark:bg-amber-950/40';
    case 'error':
      return 'border-red-200/90 bg-red-50/60 dark:border-red-800/80 dark:bg-red-950/40';
    case 'no_match':
      return 'border-slate-200/80 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/50 opacity-75';
    default:
      if (nodeType === 'verdict') {
        return verdictLabel === 'resource'
          ? 'border-violet-200/90 bg-violet-50/60 dark:border-violet-800/80 dark:bg-violet-950/40'
          : 'border-slate-200/90 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-900/50';
      }
      return 'border-indigo-200/90 bg-indigo-50/50 dark:border-indigo-800/80 dark:bg-indigo-950/40';
  }
}

function getDotColor(
  status: GraphNode['status'],
  nodeType?: GraphNode['type'],
  verdictLabel?: GraphNode['verdictLabel'],
): string {
  switch (status) {
    case 'success':
      return 'bg-emerald-500';
    case 'warning':
      return 'bg-amber-500';
    case 'error':
      return 'bg-red-500';
    case 'no_match':
      return 'bg-slate-400 dark:bg-slate-600';
    default:
      if (nodeType === 'verdict') {
        return verdictLabel === 'resource' ? 'bg-violet-500' : 'bg-slate-400 dark:bg-slate-500';
      }
      return 'bg-indigo-500';
  }
}

function getStatusPillStyles(
  node: GraphNode,
  isVi = false,
): {
  text: string;
  className: string;
} {
  switch (node.status) {
    case 'success':
      return {
        text: node.statusText ?? (isVi ? 'ĐẠT' : 'PASS'),
        className:
          'bg-emerald-100/90 text-emerald-800 border-emerald-300/80 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
      };
    case 'warning':
      return {
        text: node.statusText ?? (isVi ? 'CẢNH BÁO' : 'WARN'),
        className:
          'bg-amber-100/90 text-amber-800 border-amber-300/80 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
      };
    case 'error':
      return {
        text: node.statusText ?? (isVi ? 'LỖI' : 'FAIL'),
        className:
          'bg-red-100/90 text-red-800 border-red-300/80 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
      };
    case 'no_match':
      return {
        text: node.statusText ?? (isVi ? 'KHÔNG KHỚP' : 'NO HIT'),
        className:
          'bg-slate-200/70 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
      };
    default: {
      if (node.type === 'reference') {
        return {
          text: node.statusText ?? (isVi ? 'GỐC' : 'ROOT'),
          className:
            'bg-indigo-100/90 text-indigo-800 border-indigo-300/80 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-800',
        };
      }
      if (node.type === 'verdict') {
        const isResource =
          node.verdictLabel === 'resource' ||
          (!node.verdictLabel &&
            /resource|tài nguyên|pháp luật|statute/i.test(node.label));
        if (isResource) {
          return {
            text: node.statusText ?? (isVi ? 'NGUỒN WEB' : 'RESOURCE'),
            className:
              'bg-violet-100/90 text-violet-800 border-violet-300/80 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-800',
          };
        }
        return {
          text: node.statusText ?? (isVi ? 'CHỜ DUYỆT' : 'REVIEW'),
          className:
            'bg-slate-200/80 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
        };
      }
      return {
        text: node.statusText ?? (isVi ? 'THÔNG TIN' : 'INFO'),
        className:
          'bg-sky-100/80 text-sky-800 border-sky-300/80 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800',
      };
    }
  }
}

function getNodeIcon(node: GraphNode): React.ReactNode {
  if (node.iconOverride) return node.iconOverride;
  switch (node.type) {
    case 'reference':
      return (
        <GitBranch className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
      );
    case 'source':
      return <SourceIcon source={node.sourceKey || node.label} />;
    case 'candidate':
      if (node.sourceKey) {
        return <SourceIcon source={node.sourceKey} />;
      }
      return node.status === 'success' ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
      ) : node.status === 'warning' ? (
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 text-slate-400 dark:text-slate-500 shrink-0" />
      );
    case 'similarity':
      return (
        <Target className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0" />
      );
    case 'rules':
      return (
        <Hash className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
      );
    case 'verdict': {
      const normalizedKey =
        node.verdictLabel ??
        (node.label.toLowerCase().replace(/\s+/g, '_') as keyof typeof VERDICT_CONFIG);
      const config =
        VERDICT_CONFIG[normalizedKey as keyof typeof VERDICT_CONFIG] ??
        VERDICT_CONFIG.unresolved;
      const Icon = config.icon;
      return <Icon className={`h-4 w-4 shrink-0 ${config.color}`} />;
    }
    default:
      return null;
  }
}

export function EvidenceGraphNode({
  node,
  level = 0,
  isLast = false,
  onExpand,
  expandedNodes,
}: EvidenceGraphNodeProps) {
  const { i18n } = useTranslation();
  const isVi = Boolean(i18n.language?.startsWith('vi'));
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isExpanded = expandedNodes?.has(node.id) ?? false;
  const matchedUrl =
    node.matchedSource &&
    typeof node.matchedSource === 'object' &&
    'url' in node.matchedSource
      ? (node.matchedSource as { url?: string }).url
      : undefined;
  const statusPill = getStatusPillStyles(node, isVi);
  const isRoot = level === 0;

  return (
    <div
      className={`relative w-full min-w-0 ${level > 0 ? 'pl-6 sm:pl-7' : ''}`}
      data-testid={`evidence-node-${node.id}`}
    >
      {/* Continuous Tree Spine & Horizontal Branch Connector (always aligned regardless of card height) */}
      {level > 0 && (
        <>
          {/* Vertical Spine Segment: starts at -top-2 (-8px) to touch parent card bottom border seamlessly */}
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute left-2.5 sm:left-3 -top-2 w-[2px] bg-slate-300 dark:bg-slate-700 ${
              isLast ? 'h-[29px] rounded-bl' : '-bottom-2'
            }`}
          />
          {/* Horizontal Branch Arm */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 sm:left-3 top-[19px] w-3.5 sm:w-4 h-[2px] bg-slate-300 dark:bg-slate-700"
          />
          {/* Junction Status Dot on the Card Edge */}
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute left-[19px] sm:left-[23px] top-[16px] w-2 h-2 rounded-full ring-2 ring-white dark:ring-slate-950 ${getDotColor(
              node.status,
              node.type,
              node.verdictLabel,
            )}`}
          />
        </>
      )}

      {/* Node Card */}
      <div
        className={`w-full min-w-0 flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-all ${
          hasChildren ? 'cursor-pointer hover:shadow-xs' : 'cursor-default'
        } ${getNodeStyles(node.status, isRoot, node.type, node.verdictLabel)}`}
        onClick={() => hasChildren && onExpand?.(node.id)}
      >
        <div className="pt-0.5 shrink-0">{getNodeIcon(node)}</div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 break-words leading-snug">
                {node.label}
              </span>
              <span
                className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold border shrink-0 ${statusPill.className}`}
              >
                {statusPill.text}
              </span>
              {hasChildren && (
                <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 shrink-0">
                  ({node.children!.length})
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {matchedUrl && /^https?:\/\//i.test(matchedUrl) && (
                <a
                  href={matchedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 text-[10px] font-mono text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
                  onClick={(e) => e.stopPropagation()}
                  title={isVi ? 'Mở bản ghi nguồn gốc' : 'Open canonical source record'}
                >
                  <span>{isVi ? 'Nguồn' : 'Source'}</span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}

              {hasChildren && (
                <span className="text-slate-500 dark:text-slate-400 shrink-0 p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5">
                  {isExpanded ? (
                    <ChevronDownIcon className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </span>
              )}
            </div>
          </div>

          {node.detail && (
            <span className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 break-words [overflow-wrap:anywhere] leading-relaxed block mt-1">
              {node.detail}
            </span>
          )}
        </div>
      </div>

      {/* Children Container */}
      {hasChildren && isExpanded && (
        <div
          className={`relative mt-2 space-y-2 ${
            isRoot ? 'ml-2 sm:ml-3' : 'ml-2 sm:ml-3.5'
          }`}
        >
          {node.children!.map((child, idx) => (
            <EvidenceGraphNode
              key={child.id}
              node={child}
              level={level + 1}
              isLast={idx === node.children!.length - 1}
              onExpand={onExpand}
              expandedNodes={expandedNodes}
            />
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useStore } from '@/lib/store-context';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Mail,
  MailOpen,
  Clock,
  User,
  FileText,
  Loader2,
  AlertCircle,
  RefreshCw,
  Download,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Calendar,
  AtSign,
  Trash2,
  CheckSquare,
  Square,
  AlertTriangle,
  Paperclip,
  Radio,
  Wifi,
  WifiOff,
  Play,
  Pause,
  Plus,
  Send,
  MessageSquare,
  Upload,
  X,
  Image,
  Smile,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';
import { cn, maskPhoneNumbersInText } from '@/lib/utils';

interface EmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  fileUrl: string | null;
}

interface Email {
  id: string;
  messageId: string;
  threadId?: string | null;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  subject: string;
  textContent: string | null;
  htmlContent: string | null;
  headers?: Record<string, any> | null;
  read: boolean;
  readAt: Date | null;
  createdAt: Date;
  ticketId: string | null;
  hasAttachments: boolean;
  EmailAttachment?: EmailAttachment[];
  replies?: Array<{
    id: string;
    subject: string;
    bodyText: string | null;
    bodyHtml: string | null;
    sentAt: Date | null;
  }>;
  ticket: {
    id: string;
    ticketNumber: string;
    subject: string;
    status: string;
  } | null;
}

type EmailThread = {
  threadKey: string;
  latest: Email;
  emails: Email[];
  emailIds: string[];
  unread: boolean;
  count: number;
};

function normalizeSubject(subject: string): string {
  if (!subject) return '';

  let s = subject.trim();

  // Strip common reply/forward prefixes repeatedly (Re:, RE:, Fw:, FWD:, Fwd:, FW:)
  // Also handle variations like "Re: " with different spacing
  let changed = true;
  while (changed) {
    changed = false;
    // Match Re:, RE:, Fw:, FW:, Fwd:, FWD: at the start (case-insensitive)
    if (/^(re|fw|fwd)\s*:\s*/i.test(s)) {
      s = s.replace(/^(re|fw|fwd)\s*:\s*/i, '').trim();
      changed = true;
    }
  }

  // Remove square brackets and their content (e.g., [External], [SPAM])
  s = s.replace(/\[[^\]]*\]/g, '').trim();

  // Normalize whitespace
  s = s.replace(/\s+/g, ' ').trim();

  return s.toLowerCase();
}

function normalizeMessageId(msgId: string): string {
  if (!msgId) return '';
  // Remove angle brackets and trim whitespace
  return msgId.replace(/^<|>$/g, '').trim();
}

function extractInReplyToAndReferences(email: Email): {
  inReplyTo: string | null;
  references: string[];
} {
  const headers = email.headers || {};
  let inReplyTo: string | null = null;
  const references: string[] = [];

  // Try different header name variations (case-insensitive)
  const headerKeys = Object.keys(headers).map((k) => k.toLowerCase());

  // Extract In-Reply-To
  for (const key of ['in-reply-to', 'in_reply_to', 'inreplyto']) {
    if (headerKeys.includes(key)) {
      const value =
        headers[Object.keys(headers).find((k) => k.toLowerCase() === key)!];
      if (value) {
        inReplyTo = normalizeMessageId(String(value));
        break;
      }
    }
  }

  // Extract References
  for (const key of ['references', 'reference']) {
    if (headerKeys.includes(key)) {
      const value =
        headers[Object.keys(headers).find((k) => k.toLowerCase() === key)!];
      if (value) {
        // References can contain multiple Message-IDs separated by whitespace
        const refs = String(value).split(/\s+/).filter(Boolean);
        refs.forEach((ref) => {
          const normalized = normalizeMessageId(ref);
          if (normalized && !references.includes(normalized)) {
            references.push(normalized);
          }
        });
        break;
      }
    }
  }

  return { inReplyTo, references };
}

function buildEmailThreads(emails: Email[]): EmailThread[] {
  if (!emails || emails.length === 0) return [];

  // Build Message-ID to Email map for quick lookup
  const messageIdMap = new Map<string, Email>();
  emails.forEach((email) => {
    if (email.messageId) {
      const normalized = normalizeMessageId(email.messageId);
      messageIdMap.set(normalized, email);
      // Also store with original format in case it's needed
      if (normalized !== email.messageId) {
        messageIdMap.set(email.messageId, email);
      }
    }
  });

  // Build bidirectional graph: email -> set of related emails
  const emailGraph = new Map<Email, Set<Email>>();

  // Initialize graph with each email pointing to itself
  emails.forEach((email) => {
    emailGraph.set(email, new Set([email]));
  });

  // Step 1: Build connections using threadId (most reliable)
  const threadIdMap = new Map<string, Email[]>();
  emails.forEach((email) => {
    if (email.threadId) {
      if (!threadIdMap.has(email.threadId)) {
        threadIdMap.set(email.threadId, []);
      }
      threadIdMap.get(email.threadId)!.push(email);
    }
  });

  // Connect emails with same threadId
  threadIdMap.forEach((threadEmails) => {
    threadEmails.forEach((email1) => {
      threadEmails.forEach((email2) => {
        if (email1 !== email2) {
          emailGraph.get(email1)!.add(email2);
          emailGraph.get(email2)!.add(email1);
        }
      });
    });
  });

  // Step 2: Build connections using In-Reply-To and References headers
  for (const email of emails) {
    const { inReplyTo, references } = extractInReplyToAndReferences(email);
    const emailSet = emailGraph.get(email)!;

    // Follow In-Reply-To chain (find parent)
    if (inReplyTo) {
      const parentEmail = messageIdMap.get(inReplyTo);
      if (parentEmail && parentEmail !== email) {
        emailSet.add(parentEmail);
        // Also add this email to parent's set (bidirectional)
        const parentSet = emailGraph.get(parentEmail)!;
        parentSet.add(email);
      }
    }

    // Follow References chain (find all related emails)
    for (const refMsgId of references) {
      const refEmail = messageIdMap.get(refMsgId);
      if (refEmail && refEmail !== email) {
        emailSet.add(refEmail);
        // Also add this email to referenced email's set (bidirectional)
        const refSet = emailGraph.get(refEmail)!;
        refSet.add(email);
      }
    }
  }

  // Step 3: Build connections using normalized subject + participants (Gmail-style)
  // This is important for emails without proper headers
  const subjectGroups = new Map<string, Email[]>();

  emails.forEach((email) => {
    const normalizedSubj = normalizeSubject(email.subject || '');
    if (normalizedSubj && normalizedSubj.length > 0) {
      // Group by normalized subject only (more flexible like Gmail)
      // Participants will be checked later for better matching
      if (!subjectGroups.has(normalizedSubj)) {
        subjectGroups.set(normalizedSubj, []);
      }
      subjectGroups.get(normalizedSubj)!.push(email);
    }
  });

  // Connect emails with same normalized subject
  // Gmail-style: If normalized subject matches and they're close in time, group them
  subjectGroups.forEach((groupEmails) => {
    if (groupEmails.length > 1) {
      // Sort by date
      const sortedByDate = [...groupEmails].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

      // Connect ALL emails with same normalized subject if they're within 7 days
      // Gmail groups by subject + time proximity, participants help but aren't required
      for (let i = 0; i < sortedByDate.length; i++) {
        for (let j = i + 1; j < sortedByDate.length; j++) {
          const email1 = sortedByDate[i];
          const email2 = sortedByDate[j];

          // Check time window (7 days)
          const timeDiff = Math.abs(
            new Date(email2.createdAt).getTime() -
              new Date(email1.createdAt).getTime(),
          );
          const daysDiff = timeDiff / (1000 * 60 * 60 * 24);

          if (daysDiff > 7) continue; // Skip if too far apart

          // For same normalized subject within time window, connect them if:
          // 1. They share at least one participant (most common case), OR
          // 2. One is clearly replying to the other (from matches to), OR
          // 3. They're from the same sender (check both email and name)
          const email1From = (email1.fromEmail || '').toLowerCase();
          const email1FromName = (email1.fromName || '').toLowerCase();
          const email1To = (email1.toEmail || '').toLowerCase();
          const email2From = (email2.fromEmail || '').toLowerCase();
          const email2FromName = (email2.fromName || '').toLowerCase();
          const email2To = (email2.toEmail || '').toLowerCase();

          // Check participant overlap (by email or name)
          const hasOverlap =
            email1From === email2From ||
            email1From === email2To ||
            email1To === email2From ||
            email1To === email2To ||
            (email1FromName && email1FromName === email2FromName) ||
            (email1FromName && email1FromName === email2To) ||
            (email2FromName && email2FromName === email1To);

          // Check if it's a reply pattern (one sender matches other's recipient)
          const isReplyPattern =
            email1From === email2To ||
            email2From === email1To ||
            (email1FromName && email1FromName === email2To) ||
            (email2FromName && email2FromName === email1To);

          // Check if same sender (by email or name - common in support/helpdesk scenarios)
          const sameSender =
            (email1From === email2From && email1From.length > 0) ||
            (email1FromName &&
              email1FromName === email2FromName &&
              email1FromName.length > 0);

          // Connect if there's overlap, reply pattern, or same sender
          // This is more aggressive like Gmail
          // CRITICAL: For same normalized subject within 7 days, ALWAYS connect if same sender
          // This handles the common case: "subject" and "Re: subject" from same person
          // Gmail groups these even without proper headers
          if (sameSender) {
            // Same sender + same normalized subject = definitely same thread
            emailGraph.get(email1)!.add(email2);
            emailGraph.get(email2)!.add(email1);
          } else if (hasOverlap || isReplyPattern) {
            // Also connect if there's participant overlap or reply pattern
            emailGraph.get(email1)!.add(email2);
            emailGraph.get(email2)!.add(email1);
          }
        }
      }
    }
  });

  // Find connected components (threads) using DFS
  const visited = new Set<Email>();
  const threadGroups: Email[][] = [];

  function dfs(email: Email, component: Email[]) {
    if (visited.has(email)) return;
    visited.add(email);
    component.push(email);

    const relatedEmails = emailGraph.get(email) || new Set();
    for (const relatedEmail of relatedEmails) {
      if (!visited.has(relatedEmail)) {
        dfs(relatedEmail, component);
      }
    }
  }

  // Find all connected components
  for (const email of emails) {
    if (!visited.has(email)) {
      const component: Email[] = [];
      dfs(email, component);
      if (component.length > 0) {
        threadGroups.push(component);
      }
    }
  }

  // Final fallback: Group remaining unthreaded emails by normalized subject + sender
  // This ensures emails like "subject" and "Re: subject" are grouped even without headers
  const unthreadedEmails = emails.filter((e) => !visited.has(e));
  if (unthreadedEmails.length > 0) {
    const fallbackGroups = new Map<string, Email[]>();

    for (const email of unthreadedEmails) {
      const normalizedSubj = normalizeSubject(email.subject || '');
      const fromEmail = (email.fromEmail || '').toLowerCase();
      const fromName = (email.fromName || '').toLowerCase();

      if (normalizedSubj) {
        // Create key from normalized subject + sender (email or name)
        // This groups "subject" and "Re: subject" from same sender
        const sender = fromEmail || fromName;
        const key = `${normalizedSubj}|${sender}`;

        if (!fallbackGroups.has(key)) {
          fallbackGroups.set(key, []);
        }
        fallbackGroups.get(key)!.push(email);
      } else {
        // Emails without subject go into their own thread
        fallbackGroups.set(`no-subject-${email.id}`, [email]);
      }
    }

    // Add all fallback groups (including single emails)
    fallbackGroups.forEach((group) => {
      threadGroups.push(group);
    });
  }

  // Build final thread objects
  const threads: EmailThread[] = [];
  threadGroups.forEach((threadEmails) => {
    const sorted = [...threadEmails].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const latest = sorted[0];
    const emailIds = sorted.map((e) => e.id);
    const unread = sorted.some((e) => !e.read);

    // Generate a stable thread key
    // Prefer threadId from database, otherwise use first email's messageId
    const threadKey =
      latest.threadId || latest.messageId || `thread-${sorted[0].id}`;

    threads.push({
      threadKey,
      latest,
      emails: sorted,
      emailIds,
      unread,
      count: sorted.length,
    });
  });

  // Sort threads by latest message time (newest first)
  threads.sort(
    (a, b) =>
      new Date(b.latest.createdAt).getTime() -
      new Date(a.latest.createdAt).getTime(),
  );
  return threads;
}

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Component to render email HTML content with clickable images
function EmailContent({
  htmlContent,
  attachments,
  emailId,
  onProcessed,
}: {
  htmlContent: string;
  attachments: EmailAttachment[];
  emailId?: string;
  onProcessed?: (
    processedHtml: string,
    newAttachments: EmailAttachment[],
  ) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [processedHtml, setProcessedHtml] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [hasBrokenImages, setHasBrokenImages] = useState(false);
  const processedOnceRef = useRef<Set<string>>(new Set());
  const onProcessedRef = useRef(onProcessed);

  // Update ref when callback changes (without triggering useEffect)
  useEffect(() => {
    onProcessedRef.current = onProcessed;
  }, [onProcessed]);

  // Check if HTML has data URIs and process them
  useEffect(() => {
    if (!htmlContent || !emailId) {
      setProcessedHtml(null);
      return;
    }

    // Check if HTML already has Mega URLs (already processed)
    const hasMegaUrls = htmlContent.includes('/api/storage/mega/');
    if (hasMegaUrls) {
      // Already processed, use as-is - images should be visible
      setProcessedHtml(null); // Use original HTML
      return;
    }

    // Also check if we have image attachments but HTML doesn't reference them
    // This might mean images were processed but HTML wasn't updated
    const hasImageAttachments = attachments.some(
      (att) =>
        att.mimeType?.startsWith('image/') ||
        att.mimeType?.startsWith('video/'),
    );
    if (
      hasImageAttachments &&
      !hasMegaUrls &&
      !htmlContent.includes('cid:') &&
      !htmlContent.includes('data:')
    ) {
      // Images exist but HTML doesn't reference them - might need to trigger processing
      // But if there are no CID or data URIs, images might be separate attachments
      // In this case, we'll just use the HTML as-is
      setProcessedHtml(null);
      return;
    }

    // Check for data URIs or CID references that need processing
    const hasDataUris =
      htmlContent.includes('data:image/') ||
      htmlContent.includes('data:video/');
    const hasCidReferences = htmlContent.includes('cid:');

    // If no inline images/videos to process, use HTML as-is
    if (!hasDataUris && !hasCidReferences) {
      setProcessedHtml(null);
      return;
    }

    // If we have valid (non-truncated) data URIs, render directly
    if (hasDataUris && !hasCidReferences) {
      // Check if any data URI is truncated/broken — if so, try server processing
      const hasValidDataUri = /data:(image|video)\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/.test(htmlContent);
      if (hasValidDataUri) {
        setProcessedHtml(null);
        return;
      }
      // Data URIs exist but are all broken/truncated — fall through to server processing
      console.log('[EmailContent] Data URIs are broken/truncated, trying server processing');
    }

    // Guard: only process once per emailId to prevent spam re-renders from retriggering fetch.
    if (processedOnceRef.current.has(emailId)) return;
    processedOnceRef.current.add(emailId);

    setIsProcessing(true);

    const ac = new AbortController();

    fetch(`/api/emails/${emailId}/process-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
      .then(async (res) => {
        // Always try to parse JSON, even for error responses
        let data;
        try {
          data = await res.json();
        } catch (parseError) {
          // If JSON parsing fails, create a basic error response
          throw new Error(
            `Failed to parse response: ${res.status} ${res.statusText}`,
          );
        }

        // Check if response indicates an error
        if (!res.ok) {
          const errorMsg =
            data?.error ||
            data?.message ||
            `HTTP ${res.status}: ${res.statusText}`;
          throw new Error(errorMsg);
        }

        return data;
      })
      .then((data) => {
        console.log('[EmailContent] Processing response:', {
          success: data?.success,
          hasProcessedHtml: !!data?.processedHtml,
          processedHtmlLength: data?.processedHtml?.length,
          uploadedImagesCount: data?.uploadedImages?.length,
          message: data?.message,
        });

        // Always update HTML if processedHtml is provided
        if (
          data?.processedHtml !== null &&
          data?.processedHtml !== undefined &&
          data.processedHtml !== ''
        ) {
          console.log(
            '[EmailContent] Setting processed HTML, length:',
            data.processedHtml.length,
          );
          setProcessedHtml(data.processedHtml);

          // Notify parent component about processed images (so list updates and stops future calls)
          if (onProcessedRef.current && Array.isArray(data.uploadedImages)) {
            const newAttachments: EmailAttachment[] = data.uploadedImages
              .filter((img: any) => img && img.fileUrl) // Only include valid attachments
              .map((img: any) => ({
                id: `inline-${emailId}-${img.fileHandle || img.fileUrl || img.filename || Math.random().toString(36).slice(2)}`,
                filename: img.filename || 'unnamed-image',
                mimeType: img.mimeType || 'image/png',
                size: img.size || 0,
                fileUrl: img.fileUrl,
              }));
            console.log(
              '[EmailContent] Notifying parent with',
              newAttachments.length,
              'new attachments',
            );
            onProcessedRef.current(data.processedHtml, newAttachments);
          }
        } else if (data?.success === false) {
          // If processing failed but we have a message, log it
          console.warn(
            '[EmailContent] Image processing failed:',
            data.error || data.message,
          );
          // Don't retry if it's a known issue (like CID references that can't be resolved)
          if (
            data.message?.includes('CID references') ||
            data.error?.includes('CID')
          ) {
            // Keep the guard so we don't retry
            console.log(
              '[EmailContent] CID references cannot be resolved, skipping retry',
            );
          } else {
            // Allow retry for other errors
            processedOnceRef.current.delete(emailId);
          }
        } else if (data?.success === true) {
          // Success but no processedHtml - use original HTML
          console.log('[EmailContent] Processing completed:', data.message);
          // Even if no processedHtml, make sure we're using the original HTML
          if (!data.processedHtml && htmlContent) {
            setProcessedHtml(null); // Explicitly set to null to use original
          }
        }
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          console.error(
            '[EmailContent] Error processing inline images:',
            error,
          );
          console.error('[EmailContent] Error details:', {
            name: error?.name,
            message: error?.message,
            stack: error?.stack,
          });
        }
        // Allow retry if it failed (unless it was aborted)
        if (error?.name !== 'AbortError') {
          processedOnceRef.current.delete(emailId);
        }
      })
      .finally(() => {
        setIsProcessing(false);
      });

    return () => ac.abort();
  }, [htmlContent, emailId]);

  useEffect(() => {
    // Process images and videos in the email content to make them clickable
    const emailContentDiv = contentRef.current;
    if (!emailContentDiv) return;

    const cleanupFunctions: (() => void)[] = [];

    // Wait a bit for the HTML to be rendered
    const timeoutId = setTimeout(() => {
      // Find all images and videos in the email content
      const images = emailContentDiv.querySelectorAll('img');
      const videos = emailContentDiv.querySelectorAll('video');

      console.log(
        '[EmailContent] Found',
        images.length,
        'images and',
        videos.length,
        'videos in rendered HTML',
      );

      // Log image sources for debugging
      images.forEach((img, idx) => {
        const src = img.getAttribute('src');
        const alt = img.getAttribute('alt');
        const style = img.getAttribute('style');
        console.log(`[EmailContent] Image ${idx + 1}:`, {
          srcLength: src?.length || 0,
          srcStart: src?.substring(0, 80),
          alt,
          computedWidth: img.clientWidth,
          computedHeight: img.clientHeight,
          displayStyle: window.getComputedStyle(img).display,
        });
      });

      // Process images - style them exactly like Gmail
      images.forEach((img) => {
        // Make images clickable to open in new window
        // Display inline like Gmail (not block)
        img.style.cursor = 'pointer';
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.borderRadius = '4px';
        img.style.margin = '8px 0';
        img.style.display = 'inline-block';
        img.style.verticalAlign = 'middle';

        // CRITICAL: Ensure data URIs render properly
        // Remove any CSS that might hide images
        img.style.visibility = 'visible';
        img.style.opacity = '1';

        // Ensure image loads even if src is a data URI
        const src = img.getAttribute('src');
        if (src && src.startsWith('data:')) {
          // Data URI - ensure it's set correctly
          if (img.src !== src) {
            img.src = src;
          }
        }

        // Add click handler to open image in new window
        const handleClick = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();

          const src = img.getAttribute('src');
          if (src) {
            // If it's a data URI, create a blob URL
            if (src.startsWith('data:')) {
              try {
                const byteString = atob(src.split(',')[1]);
                const mimeString = src
                  .split(',')[0]
                  .split(':')[1]
                  .split(';')[0];
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) {
                  ia[i] = byteString.charCodeAt(i);
                }
                const blob = new Blob([ab], { type: mimeString });
                const blobUrl = URL.createObjectURL(blob);
                window.open(blobUrl, '_blank', 'noopener,noreferrer');
                // Clean up blob URL after a delay
                setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
              } catch (error) {
                console.error('Error opening image:', error);
                // Fallback: try to open the data URI directly
                window.open(src, '_blank', 'noopener,noreferrer');
              }
            } else {
              // Regular URL - open directly
              window.open(src, '_blank', 'noopener,noreferrer');
            }
          }
        };

        img.addEventListener('click', handleClick);

        // Add hover effect
        const handleMouseEnter = () => {
          img.style.opacity = '0.9';
          img.style.transition = 'opacity 0.2s';
        };
        const handleMouseLeave = () => {
          img.style.opacity = '1';
        };

        img.addEventListener('mouseenter', handleMouseEnter);
        img.addEventListener('mouseleave', handleMouseLeave);

        // Store cleanup function
        cleanupFunctions.push(() => {
          img.removeEventListener('click', handleClick);
          img.removeEventListener('mouseenter', handleMouseEnter);
          img.removeEventListener('mouseleave', handleMouseLeave);
        });
      });

      // Process videos (make them clickable and styled)
      // Display inline like Gmail (not block)
      videos.forEach((video) => {
        video.style.cursor = 'pointer';
        video.style.maxWidth = '100%';
        video.style.height = 'auto';
        video.style.borderRadius = '4px';
        video.style.margin = '8px 0';
        video.style.display = 'inline-block';
        video.style.verticalAlign = 'middle';

        // Add click handler to open video in new window
        const handleClick = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();

          const src = video.getAttribute('src');
          if (src) {
            if (src.startsWith('data:')) {
              try {
                const byteString = atob(src.split(',')[1]);
                const mimeString = src
                  .split(',')[0]
                  .split(':')[1]
                  .split(';')[0];
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) {
                  ia[i] = byteString.charCodeAt(i);
                }
                const blob = new Blob([ab], { type: mimeString });
                const blobUrl = URL.createObjectURL(blob);
                window.open(blobUrl, '_blank', 'noopener,noreferrer');
                setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
              } catch (error) {
                console.error('Error opening video:', error);
                window.open(src, '_blank', 'noopener,noreferrer');
              }
            } else {
              window.open(src, '_blank', 'noopener,noreferrer');
            }
          }
        };

        video.addEventListener('click', handleClick);

        cleanupFunctions.push(() => {
          video.removeEventListener('click', handleClick);
        });
      });
    }, 100); // Small delay to ensure HTML is rendered

    // Cleanup function for useEffect
    return () => {
      clearTimeout(timeoutId);
      cleanupFunctions.forEach((cleanup) => cleanup());
    };
  }, [processedHtml, htmlContent]);

  const displayHtml = processedHtml !== null ? processedHtml : htmlContent;

  /**
   * Clean up email HTML for safe display:
   * - Replace broken data URI images with attachment URLs when available
   * - Keep valid images (http/https URLs, /api/ paths, valid data URIs)
   * - Remove orphaned tag attribute fragments from broken img tags
   */
  const cleanEmailHtml = (html: string): string => {
    if (!html) return html;

    let cleaned = html;

    // Build a list of image attachments with valid URLs for fallback
    const imageAttachments = attachments.filter(
      (att) => att.fileUrl && (att.mimeType?.startsWith('image/') || att.mimeType?.startsWith('video/'))
    );
    let attachmentIndex = 0;

    // Remove "[Content truncated]" markers
    cleaned = cleaned.replace(/\[Content truncated\]/gi, '');

    // STEP 1: Fix complete but truncated <img> tags with data URIs.
    // If we have image attachments, use them as replacement. Otherwise show placeholder.
    cleaned = cleaned.replace(
      /<img[^>]*src=["']?(data:(image|video)\/[^;]+;base64,[^"']*?)["']?[^>]*\/?>/gi,
      (match, dataUri) => {
        if (!dataUri) return '';
        const base64Part = (dataUri.split(',')[1] || '');
        const isValid = base64Part.length >= 100 &&
                        /^[A-Za-z0-9+/=]+$/.test(base64Part) &&
                        (base64Part.length % 4 === 0 || base64Part.endsWith('='));
        if (isValid) return match;

        // Try to find a matching attachment by alt text (filename)
        const altMatch = match.match(/alt=["']?([^"'>]+)/i);
        const altText = altMatch?.[1] || '';

        // Look for attachment matching the alt text filename
        let att = altText
          ? imageAttachments.find((a) => a.filename === altText || altText.includes(a.filename))
          : undefined;

        // Fallback: use next available image attachment
        if (!att && attachmentIndex < imageAttachments.length) {
          att = imageAttachments[attachmentIndex++];
        }

        if (att?.fileUrl) {
          return `<img src="${att.fileUrl}" alt="${altText || att.filename}" style="max-width:100%;height:auto;border-radius:4px;margin:8px 0;" />`;
        }

        // No attachment available — show placeholder
        return altText
          ? `<div style="padding:12px 16px;margin:8px 0;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;color:#475569;font-size:13px;">📎 ${altText}</div>`
          : '';
      }
    );

    // STEP 2: Remove <img> tags with no valid src
    cleaned = cleaned.replace(
      /<img[^>]*\/?>/gi,
      (match) => {
        if (/src=["']?(https?:\/\/|\/api\/)[^"']+["']?/i.test(match)) return match;
        if (/src=["']?data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}["']?/i.test(match)) return match;
        return '';
      }
    );

    // STEP 3: Remove orphaned tag attribute fragments.
    // When an <img src="data:..."> tag is truncated mid-data-URI, the DB stores
    // the broken tail as visible text: " alt="Screenshot..." width="542" height="330">
    cleaned = cleaned.replace(
      /["']\s*(?:alt|width|height|style|class|id|loading|decoding|srcset)=["'][^"']*["'][^>]*>/gi,
      (match, offset) => {
        const preceding = cleaned.substring(Math.max(0, offset - 200), offset);
        const lastOpen = preceding.lastIndexOf('<');
        const lastClose = preceding.lastIndexOf('>');
        if (lastOpen > lastClose) return match; // Inside a real tag — keep it
        return '';
      }
    );

    // STEP 4: Clean standalone orphaned fragments
    cleaned = cleaned.replace(
      /(?:^|\n|\s)"\s*alt=["'][^"']*["']\s*(?:width=["'][^"']*["']\s*)?(?:height=["'][^"']*["']\s*)?(?:\/\s*)?>/gm,
      ''
    );

    // STEP 5: If the HTML has no images but we have image attachments,
    // append them at the end so the user can see them inline.
    if (!cleaned.includes('<img') && imageAttachments.length > 0) {
      const inlineImages = imageAttachments
        .map((att) => `<img src="${att.fileUrl}" alt="${att.filename}" style="max-width:100%;height:auto;border-radius:4px;margin:8px 0;display:block;" />`)
        .join('');
      cleaned += inlineImages;
    }

    return cleaned;
  };

  let fixedDisplayHtml = displayHtml ? cleanEmailHtml(displayHtml) : displayHtml;

  // Detect broken images (placeholders or truncated data URIs)
  useEffect(() => {
    if (fixedDisplayHtml) {
      // Check for placeholder markers that cleanEmailHtml inserted
      const hasPlaceholders = fixedDisplayHtml.includes('📎');
      // Check for truncated data URIs that are still present
      const hasBrokenDataUris = /data:(image|video)\/[^;]+;base64,[^"']{0,99}["']/i.test(fixedDisplayHtml);
      // Check if original HTML had data URIs but cleaned version has none
      const originalHadImages = htmlContent?.includes('data:image/') || htmlContent?.includes('cid:');
      const cleanedHasImages = fixedDisplayHtml.includes('<img') && (
        fixedDisplayHtml.includes('/api/storage/mega/') ||
        fixedDisplayHtml.includes('https://') ||
        /data:(image|video)\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/.test(fixedDisplayHtml)
      );

      setHasBrokenImages(hasPlaceholders || hasBrokenDataUris || (!!originalHadImages && !cleanedHasImages));
    }
  }, [fixedDisplayHtml, htmlContent]);

  // Handler: kick off repair, then poll for completion
  const handleRepairImages = async () => {
    if (!emailId || isRepairing) return;
    setIsRepairing(true);
    try {
      // 1. Start the repair (returns immediately)
      const startRes = await fetch(`/api/emails/${emailId}/repair-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const startData = await startRes.json();

      if (!startData?.success) {
        console.error('[Repair Images] Failed to start:', startData?.error);
        setIsRepairing(false);
        return;
      }

      // 2. Poll for completion every 3 seconds (max 60 attempts = 3 min)
      const maxPolls = 60;
      for (let i = 0; i < maxPolls; i++) {
        await new Promise(r => setTimeout(r, 3000));

        try {
          const pollRes = await fetch(`/api/emails/${emailId}/repair-images`);
          const pollData = await pollRes.json();

          if (pollData?.status === 'done') {
            if (pollData.processedHtml) {
              setProcessedHtml(pollData.processedHtml);
              setHasBrokenImages(false);
              if (onProcessedRef.current && Array.isArray(pollData.uploadedImages)) {
                const newAtts: EmailAttachment[] = pollData.uploadedImages
                  .filter((img: any) => img?.fileUrl)
                  .map((img: any) => ({
                    id: `repaired-${emailId}-${img.fileHandle || Math.random().toString(36).slice(2)}`,
                    filename: img.filename || 'repaired-image',
                    mimeType: img.mimeType || 'image/png',
                    size: img.size || 0,
                    fileUrl: img.fileUrl,
                  }));
                onProcessedRef.current(pollData.processedHtml, newAtts);
              }
            }
            break;
          }

          if (pollData?.status === 'error') {
            console.error('[Repair Images] Failed:', pollData?.error);
            break;
          }

          // status === 'processing' — continue polling
        } catch {
          // Poll failed, keep trying
        }
      }
    } catch (err: any) {
      console.error('[Repair Images] Error:', err.message);
    } finally {
      setIsRepairing(false);
    }
  };

  return (
    <div className="relative">
      {(isProcessing || isRepairing) && (
        <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10 rounded">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{isRepairing ? 'Repairing images from mail server...' : 'Processing images...'}</span>
          </div>
        </div>
      )}
      {hasBrokenImages && !isRepairing && (
        <div className="mb-3 flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span className="text-amber-700">Some images could not be displayed.</span>
          <button
            onClick={handleRepairImages}
            className="ml-auto px-3 py-1 text-xs font-medium bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-md transition-colors flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            Repair Images
          </button>
        </div>
      )}
      <div
        ref={contentRef}
        className="text-slate-700 leading-relaxed email-content"
        dangerouslySetInnerHTML={{ __html: fixedDisplayHtml || '' }}
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          lineHeight: '1.6',
          wordBreak: 'break-word',
        }}
        suppressHydrationWarning={true}
      />
      <style jsx global>{`
        .email-content img {
          max-width: 100% !important;
          width: auto !important;
          height: auto !important;
          max-height: none !important;
          display: block !important;
          margin: 8px 0 !important;
          border-radius: 4px !important;
          cursor: pointer !important;
          visibility: visible !important;
          opacity: 1 !important;
          background-color: #f3f4f6 !important;
          padding: 4px !important;
          object-fit: contain !important;
        }
        .email-content video {
          max-width: 100% !important;
          height: auto !important;
          max-height: none !important;
          display: inline-block !important;
          margin: 8px 0 !important;
          border-radius: 4px !important;
          cursor: pointer !important;
        }
        .email-content div,
        .email-content table,
        .email-content td {
          max-height: none !important;
          overflow: visible !important;
        }
      `}</style>
    </div>
  );
}

export default function MailPage() {
  const { data: session } = useSession();
  const { selectedStoreId, loading: storeLoading } = useStore();
  const { toast } = useToast();
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0); // Total count of all emails
  const [readCount, setReadCount] = useState(0); // Count of read emails
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    type: 'selected' | 'all';
    count: number;
  }>({ open: false, type: 'selected', count: 0 });

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(10); // Threads per page
  const [totalThreadPages, setTotalThreadPages] = useState(1);

  // Group emails into Gmail-style threads for the list view
  const allThreads = useMemo(() => {
    const result = buildEmailThreads(emails);
    // Debug logging (remove in production)
    if (process.env.NODE_ENV === 'development') {
      console.log('[Email Threading]', {
        totalEmails: emails.length,
        totalThreads: result.length,
        threadsWithMultipleEmails: result.filter((t) => t.count > 1).length,
        sampleThreads: result.slice(0, 3).map((t) => ({
          key: t.threadKey,
          count: t.count,
          subject: t.latest.subject,
          normalizedSubject: normalizeSubject(t.latest.subject),
        })),
      });
    }
    return result;
  }, [emails]);

  // Show exactly pageSize threads (client-side pagination of threads)
  const threads = useMemo(() => {
    return allThreads.slice(0, pageSize);
  }, [allThreads, pageSize]);

  const displayedEmailIds = useMemo(
    () => threads.flatMap((t) => t.emailIds),
    [threads],
  );

  // Real-time sync state
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{
    lastSync: string | null;
    emailsSynced: number;
    idleConnected: boolean;
  } | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);

  // Reply and Ticket Modal states
  const [replyModal, setReplyModal] = useState<{
    open: boolean;
    email: Email | null;
  }>({ open: false, email: null });
  const [ticketModal, setTicketModal] = useState<{
    open: boolean;
    email: Email | null;
  }>({ open: false, email: null });
  const [categories, setCategories] = useState<
    Array<{ id: string; name: string; subjects: string[] | null }>
  >([]);
  const [replying, setReplying] = useState(false);
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [replyForm, setReplyForm] = useState({
    subject: '',
    body: '',
    toEmail: '',
    ccEmail: '',
  });

  // Inline reply state (Gmail-style)
  const [showInlineReply, setShowInlineReply] = useState(false);
  const [ccVisible, setCcVisible] = useState(false);
  const [bccVisible, setBccVisible] = useState(false);
  const [bccEmail, setBccEmail] = useState('');
  const [replyAttachments, setReplyAttachments] = useState<File[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const replyImageInputRef = useRef<HTMLInputElement>(null);

  // Common emojis for quick picker
  const commonEmojis = [
    '😊',
    '👍',
    '🙏',
    '❤️',
    '😂',
    '🎉',
    '✅',
    '⭐',
    '🔥',
    '💯',
    '👏',
    '🤝',
    '📧',
    '📞',
    '🛒',
    '📦',
  ];
  const [ticketForm, setTicketForm] = useState({
    name: '',
    email: '',
    phone: '',
    order: '',
    trackingId: '',
    subject: '',
    description: '',
    categoryId: '',
    priority: 'NORMAL',
    assignedAgentId: '',
  });
  const [ticketFormErrors, setTicketFormErrors] = useState<
    Record<string, string>
  >({});
  const lookupTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // File upload states
  const [attachments, setAttachments] = useState<File[]>([]);
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<
    [File | null, File | null, File | null]
  >([null, null, null]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const singleFileInputRef = useRef<HTMLInputElement>(null);
  const imageFileInputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  // Check if selected category requires attachments
  const requiresAttachments = () => {
    if (!ticketForm.categoryId) return false;
    const selectedCategory = categories.find(
      (cat) => cat.id === ticketForm.categoryId,
    );
    if (!selectedCategory) return false;

    const categoryName = selectedCategory.name.toLowerCase();
    // Remove emojis and special characters, normalize spaces
    const cleanName = categoryName
      .replace(/[📦🔄&/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Check for "Order & Product Issues" or similar
    const isOrderProduct =
      cleanName.includes('order') && cleanName.includes('product');

    // Check for "Return / Refund / Replacement" or similar
    const isReturnRefund =
      cleanName.includes('return') &&
      (cleanName.includes('refund') || cleanName.includes('replacement'));

    return isOrderProduct || isReturnRefund;
  };

  // Format file size helper
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // File upload handlers
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      const maxSize = 10 * 1024 * 1024; // 10MB
      const validFiles = files.filter((file) => {
        if (file.size > maxSize) {
          toast({
            title: 'File too large',
            description: `${file.name} exceeds 10MB limit`,
            variant: 'destructive',
          });
          return false;
        }
        return true;
      });

      const newFiles = [...attachments, ...validFiles].slice(0, 5);
      setAttachments(newFiles);

      if (validFiles.length > 0) {
        toast({
          title: 'Files selected',
          description: `${validFiles.length} file(s) added`,
        });
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSingleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Check if it's a video
      if (!file.type.startsWith('video/')) {
        toast({
          title: 'Invalid file type',
          description: 'Only video files are allowed in this section',
          variant: 'destructive',
        });
        if (singleFileInputRef.current) {
          singleFileInputRef.current.value = '';
        }
        return;
      }
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        toast({
          title: 'File too large',
          description: `${file.name} exceeds 10MB limit`,
          variant: 'destructive',
        });
        if (singleFileInputRef.current) {
          singleFileInputRef.current.value = '';
        }
        return;
      }
      setSingleFile(file);
      if (ticketFormErrors.attachments) {
        setTicketFormErrors((prev) => {
          const newErrors = { ...prev };
          delete newErrors.attachments;
          return newErrors;
        });
      }
      toast({
        title: 'Video selected',
        description: `${file.name} added`,
      });
    }
    if (singleFileInputRef.current) {
      singleFileInputRef.current.value = '';
    }
  };

  const handleImageFileSelect =
    (index: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        // Check if it's an image
        if (!file.type.startsWith('image/')) {
          toast({
            title: 'Invalid file type',
            description: 'Only images are allowed in this section',
            variant: 'destructive',
          });
          if (imageFileInputRefs[index].current) {
            imageFileInputRefs[index].current.value = '';
          }
          return;
        }
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSize) {
          toast({
            title: 'File too large',
            description: `${file.name} exceeds 10MB limit`,
            variant: 'destructive',
          });
          if (imageFileInputRefs[index].current) {
            imageFileInputRefs[index].current.value = '';
          }
          return;
        }
        const newImageFiles: [File | null, File | null, File | null] = [
          ...imageFiles,
        ];
        newImageFiles[index] = file;
        setImageFiles(newImageFiles);
        if (ticketFormErrors.attachments) {
          setTicketFormErrors((prev) => {
            const newErrors = { ...prev };
            delete newErrors.attachments;
            return newErrors;
          });
        }
        toast({
          title: 'Image selected',
          description: `${file.name} added`,
        });
      }
      if (imageFileInputRefs[index].current) {
        imageFileInputRefs[index].current.value = '';
      }
    };

  const handleRemoveAttachment = (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  const handleRemoveSingleFile = () => {
    setSingleFile(null);
  };

  const handleRemoveImageFile = (index: number) => {
    const newImageFiles: [File | null, File | null, File | null] = [
      ...imageFiles,
    ];
    newImageFiles[index] = null;
    setImageFiles(newImageFiles);
  };

  // Get available subjects based on selected category
  const getAvailableSubjects = () => {
    if (!ticketForm.categoryId) {
      return [];
    }
    const selectedCategory = categories.find(
      (cat) => cat.id === ticketForm.categoryId,
    );
    if (!selectedCategory) {
      return [];
    }
    // Use subjects from database if available, otherwise return empty array
    // Handle JSON field which might be stored as object or array
    if (selectedCategory.subjects) {
      if (Array.isArray(selectedCategory.subjects)) {
        return selectedCategory.subjects.filter(
          (s: any) => s && typeof s === 'string' && s.trim() !== '',
        );
      }
      // If it's an object, try to convert it
      if (typeof selectedCategory.subjects === 'object') {
        const subjectsArray = Object.values(selectedCategory.subjects).filter(
          (s: any) => s && typeof s === 'string' && s.trim() !== '',
        );
        return subjectsArray.length > 0 ? subjectsArray : [];
      }
    }
    return [];
  };

  // Reset subject when category changes
  useEffect(() => {
    if (ticketModal.open && ticketForm.categoryId) {
      setTicketForm((prev) => ({ ...prev, subject: '' }));
    }
  }, [ticketForm.categoryId, ticketModal.open]);

  // Reset to page 1 when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filter, selectedStoreId]);

  // Fetch categories for ticket creation
  useEffect(() => {
    if (selectedStoreId) {
      const url = selectedStoreId
        ? `/api/categories?storeId=${selectedStoreId}`
        : '/api/categories';
      fetch(url)
        .then((res) => res.json())
        .then((data) => {
          const categoryArray = data.categories || [];
          setCategories(
            categoryArray.map((cat: any) => ({
              id: cat.id,
              name: cat.name,
              subjects: cat.subjects || null,
            })),
          );
        })
        .catch((error) => {
          console.error('Error fetching categories:', error);
          setCategories([]);
        });
    }
  }, [selectedStoreId]);

  // Fetch emails from database when filter, store, or page changes (with debounce)
  const fetchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear any existing debounce timer
    if (fetchDebounceRef.current) {
      clearTimeout(fetchDebounceRef.current);
    }

    if (!storeLoading && selectedStoreId) {
      // Debounce the fetch to prevent rapid re-fetching during initialization
      fetchDebounceRef.current = setTimeout(() => {
        fetchEmails();
      }, 100); // 100ms debounce
    } else if (!storeLoading && session?.user?.role !== 'ADMIN') {
      // For non-admin users without a store requirement
      fetchDebounceRef.current = setTimeout(() => {
        fetchEmails();
      }, 100);
    }

    return () => {
      if (fetchDebounceRef.current) {
        clearTimeout(fetchDebounceRef.current);
      }
    };
  }, [filter, selectedStoreId, storeLoading, currentPage, pageSize]);

  // Check sync status on load and periodically
  useEffect(() => {
    if (selectedStoreId) {
      // Check sync status immediately on mount to restore state
      checkSyncStatus();
      const interval = setInterval(checkSyncStatus, 10000); // Check every 10 seconds
      return () => clearInterval(interval);
    } else {
      // Reset sync state when store changes
      setSyncRunning(false);
      setSyncStatus(null);
    }
  }, [selectedStoreId]);

  // Auto-refresh emails when sync is running (silent - no loading spinner)
  useEffect(() => {
    if (syncRunning && selectedStoreId) {
      const interval = setInterval(() => {
        fetchEmails(true); // Pass silent=true to avoid showing loading spinner
      }, 15000); // Refresh every 15 seconds when sync is running
      return () => clearInterval(interval);
    }
  }, [syncRunning, selectedStoreId, filter, currentPage]);

  const checkSyncStatus = async () => {
    if (!selectedStoreId) return;

    try {
      const response = await fetch(
        `/api/emails/sync?storeId=${selectedStoreId}`,
      );
      if (!response.ok) return;
      let data;
      try { data = await response.json(); } catch { return; }

      if (data) {
        setSyncRunning(data.isRunning || false);
        if (data.status) {
          setSyncStatus({
            lastSync: data.status.lastSync,
            emailsSynced: data.status.emailsSynced || 0,
            idleConnected: data.status.idleConnected || false,
          });
        }
      }
    } catch (error) {
      console.error('Error checking sync status:', error);
    }
  };

  const toggleSync = async () => {
    if (!selectedStoreId) {
      toast({
        title: 'Error',
        description: 'Please select a store first',
        variant: 'destructive',
      });
      return;
    }

    setSyncLoading(true);
    try {
      const action = syncRunning ? 'stop' : 'start';
      const response = await fetch('/api/emails/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, storeId: selectedStoreId }),
      });

      let data;
      try { data = await response.json(); } catch {
        throw new Error('Email service temporarily unavailable');
      }

      if (!response.ok) {
        throw new Error(data.error || `Failed to ${action} sync`);
      }

      setSyncRunning(data.isRunning);
      if (data.status) {
        setSyncStatus({
          lastSync: data.status.lastSync,
          emailsSynced: data.status.emailsSynced || 0,
          idleConnected: data.status.idleConnected || false,
        });
      }

      toast({
        title: 'Success',
        description: data.message,
      });

      // Refresh emails after starting sync
      if (action === 'start') {
        setTimeout(() => fetchEmails(), 2000);
      }
    } catch (error: any) {
      console.error('Error toggling sync:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to toggle sync',
        variant: 'destructive',
      });
    } finally {
      setSyncLoading(false);
    }
  };

  const fetchEmails = async (silent = false) => {
    // For admins, require store selection
    if (session?.user?.role === 'ADMIN' && !selectedStoreId) {
      setLoading(false);
      return;
    }

    // Only show loading spinner for non-silent refreshes
    if (!silent) {
      setLoading(true);
    }

    try {
      // Overfetch emails so that after threading we have enough visible threads.
      // e.g. pageSize=10 → fetch 50 raw emails → typically ~20-30 threads → show 10.
      const fetchLimit = Math.min(pageSize * 5, 250);

      const params = new URLSearchParams();
      params.append('page', currentPage.toString());
      params.append('limit', fetchLimit.toString());

      if (filter === 'unread') {
        params.append('read', 'false');
      } else if (filter === 'read') {
        params.append('read', 'true');
      }
      // For 'all' filter, don't add read parameter - show all emails

      if (selectedStoreId) {
        params.append('storeId', selectedStoreId);
      }

      const response = await fetch(`/api/emails?${params.toString()}`);
      let data;
      try { data = await response.json(); } catch {
        throw new Error('Email service temporarily unavailable');
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch emails');
      }

      const fetchedEmails = data.emails || [];
      setEmails(fetchedEmails);
      setUnreadCount(data.unreadCount || 0);
      setTotalCount(data.totalAll || data.total || 0);
      setReadCount(data.readCount || 0);

      // Estimate total thread-based pages from the email-to-thread ratio
      const threadCount = buildEmailThreads(fetchedEmails).length;
      const totalEmails = filter === 'all'
        ? (data.totalAll || data.total || 0)
        : filter === 'unread'
          ? (data.unreadCount || 0)
          : (data.readCount || 0);
      if (threadCount > 0 && fetchedEmails.length > 0) {
        const avgEmailsPerThread = fetchedEmails.length / threadCount;
        const estimatedTotalThreads = totalEmails / avgEmailsPerThread;
        setTotalThreadPages(Math.max(1, Math.ceil(estimatedTotalThreads / pageSize)));
      } else {
        setTotalThreadPages(data.totalPages || 1);
      }
      setTotalPages(data.totalPages || 1);
    } catch (error: any) {
      console.error('Error fetching emails:', error);
    } finally {
      // Only update loading state for non-silent refreshes
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const markAsRead = async (emailId: string) => {
    try {
      await fetch(`/api/emails/${emailId}`, { method: 'PATCH' });
      setEmails((prev) =>
        prev.map((email) =>
          email.id === emailId
            ? { ...email, read: true, readAt: new Date() }
            : email,
        ),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error marking email as read:', error);
    }
  };

  const fetchFromGmail = async (
    mode: 'unread' | 'latest' = 'unread',
    limit?: number,
    silent = false,
  ) => {
    if (!selectedStoreId && session?.user?.role === 'ADMIN') {
      if (!silent) {
        toast({
          title: 'Error',
          description: 'Please select a store to fetch emails',
          variant: 'destructive',
        });
      }
      return;
    }

    setFetching(true);
    try {
      const response = await fetch('/api/emails/fetch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          storeId: selectedStoreId,
          mode,
          limit,
        }),
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(
          response.status === 500
            ? 'Email service temporarily unavailable. Please try again.'
            : `Server error: ${response.status} ${response.statusText}`,
        );
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch emails from Gmail');
      }

      if (!silent) {
        toast({
          title: 'Success',
          description:
            data.message ||
            `Fetched ${data.stats?.fetched || 0} emails, stored ${data.stats?.stored || 0} new emails`,
        });
      }

      // Refresh email list after fetching (with small delay to ensure emails are stored)
      setTimeout(() => {
        fetchEmails();
      }, 500);
    } catch (error: any) {
      console.error('Error fetching emails from Gmail:', error);
      if (!silent) {
        toast({
          title: 'Error',
          description: error.message || 'Failed to fetch emails from Gmail',
          variant: 'destructive',
        });
      }
    } finally {
      setFetching(false);
    }
  };

  const getEmailPreview = (email: Email) => {
    if (email.htmlContent) {
      // Strip HTML tags for preview
      const text = email.htmlContent.replace(/<[^>]*>/g, '').trim();
      return text.substring(0, 150) + (text.length > 150 ? '...' : '');
    }
    return email.textContent?.substring(0, 150) || 'No content';
  };

  const toggleEmailExpansion = (emailId: string) => {
    setExpandedEmailId(expandedEmailId === emailId ? null : emailId);
  };

  const getEmailContent = (email: Email) => {
    // Prefer HTML content if available, otherwise use text content
    if (email.htmlContent) {
      return email.htmlContent;
    }
    return email.textContent || 'No content available';
  };

  const toggleEmailSelection = (emailId: string) => {
    setSelectedEmails((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(emailId)) {
        newSet.delete(emailId);
      } else {
        newSet.add(emailId);
      }
      return newSet;
    });
  };

  const toggleThreadSelection = (emailIds: string[]) => {
    setSelectedEmails((prev) => {
      const newSet = new Set(prev);
      const allSelected =
        emailIds.length > 0 && emailIds.every((id) => newSet.has(id));

      if (allSelected) {
        emailIds.forEach((id) => newSet.delete(id));
      } else {
        emailIds.forEach((id) => newSet.add(id));
      }

      return newSet;
    });
  };

  const toggleSelectAll = () => {
    setSelectedEmails((prev) => {
      const newSet = new Set(prev);
      const allDisplayedSelected =
        displayedEmailIds.length > 0 &&
        displayedEmailIds.every((id) => newSet.has(id));

      if (allDisplayedSelected) {
        displayedEmailIds.forEach((id) => newSet.delete(id));
      } else {
        displayedEmailIds.forEach((id) => newSet.add(id));
      }

      return newSet;
    });
  };

  const deleteSelectedEmails = async () => {
    if (selectedEmails.size === 0) {
      toast({
        title: 'No emails selected',
        description: 'Please select emails to delete',
        variant: 'destructive',
      });
      return;
    }

    setDeleteDialog({
      open: true,
      type: 'selected',
      count: selectedEmails.size,
    });
  };

  const confirmDeleteSelected = async () => {
    setDeleteDialog({ open: false, type: 'selected', count: 0 });
    setDeleting(true);
    try {
      const response = await fetch('/api/emails/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailIds: Array.from(selectedEmails),
          storeId: selectedStoreId,
        }),
      });

      let data;
      try { data = await response.json(); } catch {
        throw new Error('Email service temporarily unavailable');
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete emails');
      }

      toast({
        title: 'Success',
        description: data.message || `Deleted ${data.deletedCount} email(s)`,
      });

      setSelectedEmails(new Set());
      fetchEmails();
    } catch (error: any) {
      console.error('Error deleting emails:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete emails',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const deleteAllEmails = async () => {
    if (totalCount === 0) {
      toast({
        title: 'No emails to delete',
        description: 'There are no emails to delete',
        variant: 'destructive',
      });
      return;
    }

    setDeleteDialog({
      open: true,
      type: 'all',
      count: totalCount, // Use totalCount instead of emails.length to show all emails count
    });
  };

  const confirmDeleteAll = async () => {
    setDeleteDialog({ open: false, type: 'all', count: 0 });
    setDeleting(true);
    try {
      const response = await fetch('/api/emails/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deleteAll: true,
          storeId: selectedStoreId,
        }),
      });

      let data;
      try { data = await response.json(); } catch {
        throw new Error('Email service temporarily unavailable');
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete emails');
      }

      toast({
        title: 'Success',
        description: data.message || `Deleted ${data.deletedCount} email(s)`,
      });

      setSelectedEmails(new Set());
      fetchEmails();
    } catch (error: any) {
      console.error('Error deleting all emails:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete emails',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const openReplyModal = (email: Email) => {
    setReplyForm({
      subject: email.subject.startsWith('Re:')
        ? email.subject
        : `Re: ${email.subject}`,
      body: '',
      toEmail: email.fromEmail,
      ccEmail: '',
    });
    setReplyModal({ open: true, email });
  };

  const closeReplyModal = () => {
    setReplyModal({ open: false, email: null });
    setReplyForm({ subject: '', body: '', toEmail: '', ccEmail: '' });
  };

  const sendReply = async () => {
    // For inline reply, use expandedEmailId; for modal, use replyModal.email
    const emailId = expandedEmailId || replyModal.email?.id;

    if (!emailId || !replyForm.body.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a reply message',
        variant: 'destructive',
      });
      return;
    }

    setReplying(true);
    try {
      const response = await fetch(`/api/emails/${emailId}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject: replyForm.subject,
          body: replyForm.body,
          toEmail: replyForm.toEmail,
          ccEmail: replyForm.ccEmail || undefined,
        }),
      });

      let data;
      try { data = await response.json(); } catch {
        throw new Error('Email service temporarily unavailable');
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send reply');
      }

      toast({
        title: 'Success',
        description: 'Email reply sent successfully',
      });

      // Close inline reply form or modal
      setShowInlineReply(false);
      closeReplyModal();
      setReplyForm({ subject: '', body: '', toEmail: '', ccEmail: '' });
      fetchEmails(); // Refresh to show updated email
    } catch (error: any) {
      console.error('Error sending reply:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to send email reply',
        variant: 'destructive',
      });
    } finally {
      setReplying(false);
    }
  };

  const openTicketModal = async (email: Email) => {
    if (email.ticketId) {
      // Verify the ticket actually exists before showing error
      try {
        const response = await fetch(`/api/tickets/${email.ticketId}`);
        if (response.ok) {
          const ticketData = await response.json();
          if (ticketData.ticket) {
            toast({
              title: 'Already Linked',
              description: 'This email is already linked to a ticket',
              variant: 'destructive',
            });
            return;
          }
        }
        // Ticket doesn't exist - backend will clear invalid ticketId when creating new ticket
        // Continue to open modal
      } catch (error) {
        console.error('Error checking ticket:', error);
        // If check fails, allow ticket creation to proceed
        // Backend will verify and clear invalid ticketId if needed
      }
    }
    // Pre-fill form with email data
    const emailContent =
      email.textContent || email.htmlContent?.replace(/<[^>]*>/g, '') || '';
    setTicketForm({
      name: email.fromName || email.fromEmail.split('@')[0] || '',
      email: email.fromEmail,
      phone: '',
      order: '',
      trackingId: '',
      subject: email.subject,
      description: emailContent.substring(0, 5000), // Limit description length
      categoryId: '',
      priority: 'NORMAL',
      assignedAgentId: '',
    });
    setTicketFormErrors({});
    // Reset file uploads
    setAttachments([]);
    setSingleFile(null);
    setImageFiles([null, null, null]);
    setTicketModal({ open: true, email });
  };

  const closeTicketModal = () => {
    // Clear timeout if modal is closed
    if (lookupTimeoutRef.current) {
      clearTimeout(lookupTimeoutRef.current);
    }
    setTicketModal({ open: false, email: null });
    setTicketForm({
      name: '',
      email: '',
      phone: '',
      order: '',
      trackingId: '',
      subject: '',
      description: '',
      categoryId: '',
      priority: 'NORMAL',
      assignedAgentId: '',
    });
    setTicketFormErrors({});
    // Reset file uploads
    setAttachments([]);
    setSingleFile(null);
    setImageFiles([null, null, null]);
  };

  // Lookup Order ID and Tracking ID by phone number
  const lookupOrderTracking = async (phone: string) => {
    try {
      // Normalize phone number
      const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '');

      if (normalizedPhone.length < 10) {
        return;
      }

      // Build lookup URL with storeId if available
      const params = new URLSearchParams({
        phone: normalizedPhone,
      });
      if (selectedStoreId) {
        params.append('storeId', selectedStoreId);
      }

      const response = await fetch(
        `/api/order-tracking/lookup?${params.toString()}`,
      );
      const data = await response.json();

      if (data.found && data.orderId && data.trackingId) {
        // Auto-fill Order ID and Tracking ID
        setTicketForm((prev) => ({
          ...prev,
          order: data.orderId,
          trackingId: data.trackingId,
        }));

        // Clear any existing errors for these fields
        setTicketFormErrors((prev) => ({
          ...prev,
          order: '',
          trackingId: '',
        }));

        toast({
          title: 'Order information found',
          description: 'Order ID and Tracking ID have been auto-filled',
        });
      }
    } catch (error) {
      // Silently fail - don't show error if lookup fails
      console.error('Error looking up order tracking:', error);
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (lookupTimeoutRef.current) {
        clearTimeout(lookupTimeoutRef.current);
      }
    };
  }, []);

  const validateTicketForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!ticketForm.name.trim()) {
      errors.name = 'Name is required';
    } else if (ticketForm.name.trim().length < 2) {
      errors.name = 'Name must be at least 2 characters';
    }

    if (!ticketForm.email.trim()) {
      errors.email = 'Email is required';
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(ticketForm.email)) {
        errors.email = 'Please enter a valid email address';
      }
    }

    if (!ticketForm.phone.trim()) {
      errors.phone = 'Phone number is required';
    }

    if (!ticketForm.order.trim()) {
      errors.order = 'Order ID is required';
    }

    if (!ticketForm.trackingId.trim()) {
      errors.trackingId = 'Tracking ID is required';
    }

    if (!ticketForm.categoryId.trim()) {
      errors.categoryId = 'Category is required';
    }

    if (!ticketForm.subject.trim()) {
      errors.subject = 'Subject is required';
    } else if (ticketForm.subject.trim().length < 5) {
      errors.subject = 'Subject must be at least 5 characters';
    }

    if (!ticketForm.description.trim()) {
      errors.description = 'Description is required';
    } else if (ticketForm.description.trim().length < 20) {
      errors.description =
        'Please provide more details (at least 20 characters)';
    }

    // Check if attachments are required for selected category
    if (requiresAttachments()) {
      // Collect all files: single file + image files + old attachments
      const allFiles: File[] = [];
      if (singleFile) allFiles.push(singleFile);
      imageFiles.forEach((file) => {
        if (file) allFiles.push(file);
      });
      attachments.forEach((file) => allFiles.push(file));

      if (allFiles.length === 0) {
        errors.attachments = 'Images or videos are required for this category';
      }
    }

    setTicketFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const createTicketFromEmail = async () => {
    if (!ticketModal.email) return;

    // Validate form
    if (!validateTicketForm()) {
      toast({
        title: 'Validation Error',
        description: 'Please fill in all required fields correctly',
        variant: 'destructive',
      });
      return;
    }

    setCreatingTicket(true);
    try {
      // Collect all files: single file + image files + attachments
      const allFiles: File[] = [];
      if (singleFile) allFiles.push(singleFile);
      imageFiles.forEach((file) => {
        if (file) allFiles.push(file);
      });
      attachments.forEach((file) => allFiles.push(file));

      let response: Response;

      if (allFiles.length > 0) {
        // Use FormData for file uploads
        const formDataToSend = new FormData();
        formDataToSend.append('name', ticketForm.name.trim());
        formDataToSend.append('email', ticketForm.email.trim());
        formDataToSend.append('phone', ticketForm.phone.trim());
        formDataToSend.append('order', ticketForm.order.trim());
        formDataToSend.append('trackingId', ticketForm.trackingId.trim());
        formDataToSend.append('subject', ticketForm.subject.trim());
        formDataToSend.append('description', ticketForm.description.trim());
        formDataToSend.append('categoryId', ticketForm.categoryId || '');
        formDataToSend.append('priority', ticketForm.priority);
        if (ticketForm.assignedAgentId) {
          formDataToSend.append('assignedAgentId', ticketForm.assignedAgentId);
        }

        allFiles.forEach((file) => {
          formDataToSend.append('attachments', file);
        });

        response = await fetch(
          `/api/emails/${ticketModal.email.id}/create-ticket`,
          {
            method: 'POST',
            body: formDataToSend,
          },
        );
      } else {
        // Use JSON for no files
        response = await fetch(
          `/api/emails/${ticketModal.email.id}/create-ticket`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: ticketForm.name.trim(),
              email: ticketForm.email.trim(),
              phone: ticketForm.phone.trim(),
              order: ticketForm.order.trim(),
              trackingId: ticketForm.trackingId.trim(),
              subject: ticketForm.subject.trim(),
              description: ticketForm.description.trim(),
              categoryId: ticketForm.categoryId || undefined,
              priority: ticketForm.priority,
              assignedAgentId: ticketForm.assignedAgentId || undefined,
            }),
          },
        );
      }

      let data;
      try { data = await response.json(); } catch {
        throw new Error('Service temporarily unavailable');
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create ticket');
      }

      toast({
        title: 'Success',
        description: `Ticket ${data.ticket?.ticketNumber} created successfully`,
      });

      closeTicketModal();
      fetchEmails(); // Refresh to show updated email with ticket link
    } catch (error: any) {
      console.error('Error creating ticket:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create ticket from email',
        variant: 'destructive',
      });
    } finally {
      setCreatingTicket(false);
    }
  };

  if (storeLoading || loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (session?.user?.role === 'ADMIN' && !selectedStoreId) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-h1 mb-2">Mail</h1>
          <p className="text-gray-600">View and manage all incoming emails</p>
        </div>
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">
                Please select a store to view emails
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                  <Mail className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-slate-800">Mail</h1>
                  <p className="text-sm text-slate-500">Manage your inbox</p>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {unreadCount > 0 && (
                <div className="flex items-center bg-red-50 text-red-600 px-4 py-2 rounded-lg border border-red-100">
                  <span className="font-semibold">{unreadCount}</span>
                  <span className="ml-1 text-sm">unread</span>
                </div>
              )}

              {selectedEmails.size > 0 ? (
                <>
                  <Button
                    onClick={deleteSelectedEmails}
                    disabled={deleting}
                    className="gap-2 bg-red-500 hover:bg-red-600 text-white shadow-md"
                  >
                    {deleting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    <span className="font-medium">
                      {deleting
                        ? 'Deleting...'
                        : `Delete Selected (${selectedEmails.size})`}
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setSelectedEmails(new Set())}
                    disabled={deleting}
                    className="font-medium"
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  {session?.user?.role === 'ADMIN' && (
                    <Button
                      onClick={deleteAllEmails}
                      disabled={deleting || emails.length === 0}
                      className="gap-2 bg-red-500 hover:bg-red-600 text-white shadow-md"
                    >
                      {deleting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                      <span className="font-medium">
                        {deleting ? 'Deleting...' : 'Delete All'}
                      </span>
                    </Button>
                  )}

                  {session?.user?.role === 'ADMIN' && (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => fetchFromGmail('unread')}
                        disabled={fetching || !selectedStoreId}
                        className="gap-2"
                      >
                        {fetching ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                        <span className="font-medium">
                          {fetching ? 'Fetching...' : 'Fetch Unread'}
                        </span>
                      </Button>

                      <Button
                        variant="outline"
                        onClick={() => fetchFromGmail('latest')}
                        disabled={fetching || !selectedStoreId}
                        className="gap-2"
                      >
                        {fetching ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                        <span className="font-medium">
                          {fetching ? 'Fetching...' : 'Fetch Latest'}
                        </span>
                      </Button>

                      <Button
                        variant={syncRunning ? 'default' : 'outline'}
                        onClick={toggleSync}
                        disabled={syncLoading || !selectedStoreId}
                        className={cn(
                          'gap-2',
                          syncRunning &&
                            'bg-green-600 hover:bg-green-700 text-white',
                        )}
                      >
                        {syncLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : syncRunning ? (
                          <Wifi className="w-4 h-4" />
                        ) : (
                          <WifiOff className="w-4 h-4" />
                        )}
                        <span className="font-medium">
                          {syncLoading
                            ? 'Loading...'
                            : syncRunning
                              ? 'Sync On'
                              : 'Sync Off'}
                        </span>
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        {/* Tabs and Search */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex space-x-2">
              <Button
                onClick={() => setFilter('all')}
                className={cn(
                  'px-5 py-2.5 rounded-lg font-medium transition-all',
                  filter === 'all'
                    ? 'bg-blue-500 text-white shadow-md hover:bg-blue-600'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                )}
              >
                All ({totalCount})
              </Button>
              <Button
                onClick={() => setFilter('unread')}
                className={cn(
                  'px-5 py-2.5 rounded-lg font-medium transition-all',
                  filter === 'unread'
                    ? 'bg-blue-500 text-white shadow-md hover:bg-blue-600'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                )}
              >
                Unread ({unreadCount})
              </Button>
              <Button
                onClick={() => setFilter('read')}
                className={cn(
                  'px-5 py-2.5 rounded-lg font-medium transition-all',
                  filter === 'read'
                    ? 'bg-blue-500 text-white shadow-md hover:bg-blue-600'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                )}
              >
                Read ({readCount})
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm text-slate-500">
            <label className="flex items-center space-x-2 cursor-pointer">
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-2"
              >
                {selectedEmails.size === emails.length && emails.length > 0 ? (
                  <CheckSquare className="w-4 h-4 text-primary" />
                ) : (
                  <Square className="w-4 h-4 text-gray-400" />
                )}
                <span>
                  {selectedEmails.size === emails.length && emails.length > 0
                    ? 'Deselect All'
                    : 'Select All'}
                </span>
              </button>
            </label>
            <span>
              Showing {threads.length > 0 ? 1 : 0}-{threads.length}
              {' '}of{' '}
              {filter === 'all'
                ? totalCount
                : filter === 'unread'
                  ? unreadCount
                  : readCount}{' '}emails
            </span>
          </div>
        </div>

        {/* Real-time Sync Status Bar */}
        {syncRunning && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Wifi className="w-5 h-5 text-green-600" />
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              </div>
              <div>
                <span className="text-sm font-medium text-green-800">
                  Real-time sync active
                </span>
                {syncStatus?.idleConnected && (
                  <span className="ml-2 text-xs text-green-600">
                    • Connected
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm text-green-700">
              {syncStatus?.lastSync && (
                <span>
                  Last sync:{' '}
                  {new Date(syncStatus.lastSync).toLocaleTimeString()}
                </span>
              )}
              {syncStatus?.emailsSynced !== undefined &&
                syncStatus.emailsSynced > 0 && (
                  <span className="font-medium">
                    {syncStatus.emailsSynced} emails synced
                  </span>
                )}
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleSync}
                disabled={syncLoading}
                className="text-green-700 hover:text-green-800 hover:bg-green-100 h-7 px-2"
              >
                {syncLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Pause className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Fetching Loader Overlay - Only show when fetching and no emails yet */}
        {fetching && emails.length === 0 && (
          <Card className="mb-4">
            <CardContent className="py-12">
              <div className="text-center">
                <div className="relative mx-auto w-16 h-16 mb-4">
                  <div className="absolute inset-0 rounded-full border-4 border-blue-100"></div>
                  <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin"></div>
                  <Mail className="absolute inset-0 w-8 h-8 text-blue-500 m-auto" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Fetching Emails...
                </h3>
                <p className="text-sm text-gray-500 max-w-sm mx-auto">
                  Connecting to Gmail and downloading emails. This may take a
                  moment if you have many unread emails.
                </p>
                <div className="flex items-center justify-center gap-1 mt-4">
                  <span
                    className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  ></span>
                  <span
                    className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  ></span>
                  <span
                    className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  ></span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Email List - Full Width Layout */}
        {/* Show empty state only when NOT fetching AND no emails */}
        {!fetching && emails.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 h-96 flex items-center justify-center">
            <div className="text-center">
              <Mail className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-600 mb-2">
                {filter === 'unread' ? 'No Unread Emails' : 'No Emails Found'}
              </h3>
              <p className="text-slate-500">
                {filter === 'unread'
                  ? 'All caught up! No unread emails.'
                  : 'Select a different filter or fetch new emails'}
              </p>
            </div>
          </div>
        ) : emails.length > 0 && !expandedEmailId ? (
          // Full-width Email List View (show emails even when fetching in background)
          <div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              {threads.map((thread) => {
                const email = thread.latest;
                const isSelected =
                  thread.emailIds.length > 0 &&
                  thread.emailIds.every((id) => selectedEmails.has(id));
                return (
                  <div
                    key={thread.threadKey}
                    onClick={() => {
                      setExpandedEmailId(email.id);
                      // Mark all unread emails in this thread as read (best effort)
                      thread.emails.forEach((e) => {
                        if (!e.read) {
                          markAsRead(e.id);
                        }
                      });
                    }}
                    className={cn(
                      'p-4 border-b border-slate-100 cursor-pointer transition-all hover:bg-slate-50',
                      thread.unread && 'bg-blue-50/50',
                      isSelected && 'ring-2 ring-primary ring-offset-2',
                    )}
                  >
                    <div className="flex items-start space-x-4">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleThreadSelection(thread.emailIds);
                        }}
                        className="mt-1"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-primary" />
                        ) : (
                          <Square className="w-4 h-4 text-gray-400 hover:text-gray-600" />
                        )}
                      </button>

                      <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0">
                        {(email.fromName || email.fromEmail)
                          .charAt(0)
                          .toUpperCase()}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center space-x-2">
                            <h3 className="font-semibold text-slate-800">
                              {email.fromName || email.fromEmail}
                            </h3>
                            {thread.unread && (
                              <span className="px-2 py-0.5 bg-blue-500 text-white text-xs rounded-full font-medium">
                                New
                              </span>
                            )}
                            {thread.count > 1 && (
                              <span className="px-2 py-0.5 bg-slate-200 text-slate-700 text-xs rounded-full font-medium">
                                {thread.count}
                              </span>
                            )}
                            {email.ticket && (
                              <Badge className="text-xs bg-green-100 text-green-700 border-green-300">
                                ✓ Ticket
                              </Badge>
                            )}
                            {email.hasAttachments && (
                              <Paperclip className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                          <div className="flex items-center text-xs text-slate-400">
                            <Clock className="w-3 h-3 mr-1" />
                            {format(
                              new Date(email.createdAt),
                              'MMM d, yyyy h:mm a',
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium text-slate-600">
                            {email.subject || '(No Subject)'}
                          </p>
                          {thread.count > 1 && (
                            <span className="text-xs text-slate-400">
                              ({thread.count} messages)
                            </span>
                          )}
                        </div>

                        <p className="text-sm text-slate-500 truncate">
                          {getEmailPreview(email)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between pt-4">
              <div className="flex items-center gap-3 text-sm text-slate-500">
                <span>Page {currentPage} of {totalThreadPages}</span>
                <span className="text-slate-300">|</span>
                <div className="flex items-center gap-1.5">
                  <span>Rows</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="border border-slate-200 rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((prev) => Math.max(1, prev - 1))
                  }
                  disabled={currentPage === 1}
                  className="gap-1"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((prev) => Math.min(totalThreadPages, prev + 1))
                  }
                  disabled={currentPage === totalThreadPages}
                  className="gap-1"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          !fetching &&
          expandedEmailId &&
          // Full-width Email Detail View (Gmail-style conversation)
          (() => {
            const selectedEmail = emails.find((e) => e.id === expandedEmailId);
            if (!selectedEmail) return null;

            // Find full thread for this email to show all messages in chronological order
            const currentThread = threads.find((t) =>
              t.emailIds.includes(expandedEmailId),
            );
            const conversationEmails = currentThread
              ? [...currentThread.emails].sort(
                  (a, b) =>
                    new Date(a.createdAt).getTime() -
                    new Date(b.createdAt).getTime(),
                )
              : [selectedEmail];
            // All emails in chronological order (oldest to newest) - latest reply will be at bottom

            return (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200">
                {/* Back Button Header */}
                <div className="p-4 border-b border-slate-200 bg-slate-50">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setExpandedEmailId(null);
                      setShowInlineReply(false);
                    }}
                    className="gap-2"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back to Inbox
                  </Button>
                </div>

                {/* Display all emails in chronological order (oldest to newest) */}
                <div className="divide-y divide-slate-200">
                  {conversationEmails.map((email, index) => {
                    const isSelectedEmail = email.id === selectedEmail.id;
                    return (
                      <div key={email.id} className="p-6">
                        {/* Email Header */}
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-start space-x-4">
                            <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center text-white font-semibold text-lg">
                              {(email.fromName || email.fromEmail)
                                .charAt(0)
                                .toUpperCase()}
                            </div>
                            <div>
                              <h2 className="text-xl font-bold text-slate-800">
                                {email.fromName || email.fromEmail}
                              </h2>
                              <p className="text-sm text-slate-500">
                                {email.fromEmail}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            {isSelectedEmail && (
                              <>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleEmailSelection(email.id);
                                  }}
                                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                  {selectedEmails.has(email.id) ? (
                                    <CheckSquare className="w-5 h-5 text-primary" />
                                  ) : (
                                    <Square className="w-5 h-5 text-slate-400" />
                                  )}
                                </button>
                                <button
                                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                                  onClick={() => {
                                    setSelectedEmails(new Set([email.id]));
                                    deleteSelectedEmails();
                                  }}
                                >
                                  <Trash2 className="w-5 h-5 text-slate-400" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2 text-sm mb-4">
                          <div className="flex items-center text-slate-600">
                            <span className="font-medium w-20">To:</span>
                            <span>{email.toEmail}</span>
                          </div>
                          <div className="flex items-center text-slate-600">
                            <span className="font-medium w-20">Date:</span>
                            <span>
                              {format(
                                new Date(email.createdAt),
                                'MMM d, yyyy h:mm a',
                              )}
                            </span>
                          </div>
                        </div>

                        <div className="mb-4">
                          <h3 className="text-lg font-semibold text-slate-800">
                            {email.subject || '(No Subject)'}
                          </h3>
                        </div>

                        {/* Email Content */}
                        <div
                          className="prose max-w-none email-content-wrapper mb-4"
                          style={{ wordBreak: 'break-word' }}
                        >
                          {email.htmlContent ? (
                            <EmailContent
                              htmlContent={maskPhoneNumbersInText(
                                email.htmlContent,
                              )}
                              attachments={email.EmailAttachment || []}
                              emailId={email.id}
                              onProcessed={(processedHtml, newAttachments) => {
                                // Update the email in the list with processed HTML and new attachments
                                setEmails((prevEmails) =>
                                  prevEmails.map((e) =>
                                    e.id === email.id
                                      ? {
                                          ...e,
                                          htmlContent: processedHtml,
                                          EmailAttachment: [
                                            ...(e.EmailAttachment || []),
                                            ...newAttachments,
                                          ],
                                          hasAttachments: true,
                                        }
                                      : e,
                                  ),
                                );
                              }}
                            />
                          ) : (
                            <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">
                              {maskPhoneNumbersInText(email.textContent) ||
                                'No content available'}
                            </p>
                          )}
                        </div>

                        {/* Attachments Section */}
                        {(() => {
                          // Filter out inline images (those embedded in email body) from attachments display
                          const regularAttachments = (email.EmailAttachment || []).filter(
                            (att) => !att.filename.startsWith('inline-image-') && !att.filename.startsWith('inline-video-')
                          );
                          return regularAttachments.length > 0 ? (
                          <div className="mt-4 bg-slate-50 rounded-lg border border-slate-200 p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <Paperclip className="w-4 h-4 text-slate-500" />
                                <span className="text-sm font-medium text-slate-700">
                                  Attachments ({regularAttachments.length})
                                </span>
                              </div>
                              <div className="text-xs text-slate-500">
                                From: {email.fromName || email.fromEmail} •{' '}
                                {format(
                                  new Date(email.createdAt),
                                  'MMM d, yyyy h:mm a',
                                )}
                              </div>
                            </div>
                            <div className="grid gap-2">
                              {regularAttachments.map((attachment) => {
                                const isImage =
                                  attachment.mimeType?.startsWith('image/');

                                return attachment.fileUrl ? (
                                  <a
                                    key={attachment.id}
                                    href={attachment.fileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors group"
                                  >
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                      {isImage ? (
                                        <div className="w-16 h-16 rounded-lg bg-slate-100 flex-shrink-0 overflow-hidden border border-slate-200 relative">
                                          <img
                                            src={attachment.fileUrl}
                                            alt={attachment.filename}
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                              const target =
                                                e.target as HTMLImageElement;
                                              target.style.display = 'none';
                                            }}
                                          />
                                          <div className="absolute inset-0 flex items-center justify-center bg-slate-100 hidden">
                                            <Image className="w-6 h-6 text-slate-400" />
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                                          <FileText className="w-5 h-5 text-blue-600" />
                                        </div>
                                      )}
                                      <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-slate-900 group-hover:text-blue-600 truncate">
                                          {attachment.filename}
                                        </div>
                                        <div className="text-xs text-slate-500">
                                          {attachment.mimeType} •{' '}
                                          {formatFileSize(attachment.size)}
                                          {isImage && (
                                            <span className="ml-1 text-blue-600">
                                              (Image)
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <Download className="w-4 h-4 text-slate-400 group-hover:text-blue-600 ml-2 flex-shrink-0" />
                                  </a>
                                ) : (
                                  <div
                                    key={attachment.id}
                                    className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200"
                                  >
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                                        <FileText className="w-5 h-5 text-amber-600" />
                                      </div>
                                      <div>
                                        <div className="text-sm font-medium text-slate-900">
                                          {attachment.filename}
                                        </div>
                                        <div className="text-xs text-amber-600">
                                          Processing... •{' '}
                                          {formatFileSize(attachment.size)}
                                        </div>
                                      </div>
                                    </div>
                                    <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : email.hasAttachments && regularAttachments.length === 0 ? (
                          // Only show processing message if there are NO regular attachments
                          // (inline images are handled separately in email body)
                          null
                        ) : email.hasAttachments ? (
                          <div className="mt-4 bg-amber-50 rounded-lg border border-amber-200 p-4">
                            <div className="flex items-center gap-2">
                              <Paperclip className="w-4 h-4 text-amber-500" />
                              <span className="text-sm font-medium text-amber-700">
                                This email has attachments (processing or data
                                unavailable)
                              </span>
                            </div>
                          </div>
                        ) : null;
                        })()}

                        {/* Linked Ticket */}
                        {email.ticket && (
                          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                            <FileText className="w-4 h-4" />
                            <span>
                              Linked to ticket:{' '}
                              <strong>{email.ticket.ticketNumber}</strong>
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Replies Section (agent outbound) - Show at bottom after all emails */}
                {selectedEmail.replies && selectedEmail.replies.length > 0 && (
                  <div className="p-6 border-t border-slate-200 bg-green-50">
                    <div className="flex items-center gap-2 mb-3">
                      <Send className="w-4 h-4 text-green-600" />
                      <span className="text-sm font-medium text-green-700">
                        Your Replies ({selectedEmail.replies.length})
                      </span>
                    </div>
                    <div className="space-y-3">
                      {selectedEmail.replies.map((reply: any) => (
                        <div
                          key={reply.id}
                          className="p-4 bg-white rounded-lg border border-green-200"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs text-slate-500">
                              {reply.sentAt
                                ? format(
                                    new Date(reply.sentAt),
                                    'MMM d, yyyy h:mm a',
                                  )
                                : 'Pending'}
                            </span>
                          </div>
                          {/* Use EmailContent component to render HTML with images */}
                          {reply.bodyHtml ? (
                            <div className="email-content-wrapper">
                              <EmailContent
                                htmlContent={reply.bodyHtml}
                                attachments={[]}
                                emailId={reply.id}
                              />
                            </div>
                          ) : (
                            <p className="text-sm text-slate-700 whitespace-pre-wrap">
                              {reply.bodyText || 'No content'}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Buttons - Only show when reply is not open */}
                {!showInlineReply && selectedEmail && (
                  <div className="p-6 border-t border-slate-200 bg-slate-50">
                    <div className="flex items-center space-x-3">
                      <Button
                        onClick={() => {
                          setShowInlineReply(true);
                          setReplyForm({
                            subject: `Re: ${selectedEmail.subject}`,
                            body: '',
                            toEmail: selectedEmail.fromEmail,
                            ccEmail: '',
                          });
                          setBccEmail('');
                          setCcVisible(false);
                          setBccVisible(false);
                        }}
                        className="gap-2 bg-blue-500 hover:bg-blue-600 text-white shadow-md"
                      >
                        <Send className="w-4 h-4" />
                        <span>Reply</span>
                      </Button>

                      {!selectedEmail.read && (
                        <Button
                          variant="outline"
                          onClick={() => markAsRead(selectedEmail.id)}
                        >
                          Mark as Read
                        </Button>
                      )}

                      {!selectedEmail.ticket && (
                        <Button
                          variant="outline"
                          onClick={() => openTicketModal(selectedEmail)}
                        >
                          Create Ticket
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Gmail-Style Inline Reply Form */}
                {showInlineReply && selectedEmail && (
                  <div className="border-t border-slate-200">
                    <div className="p-6">
                      {/* Reply Header */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2 text-slate-700">
                          <Send className="w-5 h-5" />
                          <span className="font-medium">Reply</span>
                        </div>
                        <button
                          onClick={() => setShowInlineReply(false)}
                          className="text-slate-500 hover:text-slate-700 p-1 hover:bg-slate-100 rounded"
                        >
                          <ChevronUp className="w-5 h-5" />
                        </button>
                      </div>

                      {/* From Field (Display Only) */}
                      <div className="mb-3 flex items-center text-sm">
                        <span className="text-slate-600 w-16">From:</span>
                        <span className="text-slate-900">
                          {selectedEmail.toEmail}
                        </span>
                      </div>

                      {/* To Field */}
                      <div className="mb-3 flex items-start">
                        <span className="text-slate-600 w-16 pt-2 text-sm">
                          To:
                        </span>
                        <div className="flex-1">
                          <input
                            type="text"
                            value={replyForm.toEmail}
                            onChange={(e) =>
                              setReplyForm({
                                ...replyForm,
                                toEmail: e.target.value,
                              })
                            }
                            className="w-full px-3 py-2 border-b border-slate-300 focus:border-blue-500 focus:outline-none text-sm"
                          />
                          {!ccVisible && !bccVisible && (
                            <div className="mt-1 flex gap-3">
                              <button
                                onClick={() => setCcVisible(true)}
                                className="text-sm text-slate-600 hover:text-slate-900"
                              >
                                Cc
                              </button>
                              <button
                                onClick={() => setBccVisible(true)}
                                className="text-sm text-slate-600 hover:text-slate-900"
                              >
                                Bcc
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* CC Field */}
                      {ccVisible && (
                        <div className="mb-3 flex items-center">
                          <span className="text-slate-600 w-16 text-sm">
                            Cc:
                          </span>
                          <input
                            type="text"
                            value={replyForm.ccEmail}
                            onChange={(e) =>
                              setReplyForm({
                                ...replyForm,
                                ccEmail: e.target.value,
                              })
                            }
                            placeholder="CC email addresses"
                            className="flex-1 px-3 py-2 border-b border-slate-300 focus:border-blue-500 focus:outline-none text-sm"
                          />
                        </div>
                      )}

                      {/* BCC Field */}
                      {bccVisible && (
                        <div className="mb-3 flex items-center">
                          <span className="text-slate-600 w-16 text-sm">
                            Bcc:
                          </span>
                          <input
                            type="text"
                            value={bccEmail}
                            onChange={(e) => setBccEmail(e.target.value)}
                            placeholder="BCC email addresses"
                            className="flex-1 px-3 py-2 border-b border-slate-300 focus:border-blue-500 focus:outline-none text-sm"
                          />
                        </div>
                      )}

                      {/* Subject Field */}
                      <div className="mb-4 flex items-center">
                        <span className="text-slate-600 w-16 text-sm">
                          Subject:
                        </span>
                        <input
                          type="text"
                          value={replyForm.subject}
                          readOnly
                          className="flex-1 px-3 py-2 border-b border-slate-300 focus:border-blue-500 focus:outline-none text-sm bg-slate-50"
                        />
                      </div>

                      {/* Message Textarea */}
                      <div className="mb-4">
                        <textarea
                          value={replyForm.body}
                          onChange={(e) =>
                            setReplyForm({ ...replyForm, body: e.target.value })
                          }
                          placeholder="Type your reply here..."
                          className="w-full px-3 py-3 border border-slate-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none text-sm min-h-[200px] resize-y"
                        />
                      </div>

                      {/* Attached Files Preview */}
                      {replyAttachments.length > 0 && (
                        <div className="mb-4 flex flex-wrap gap-2">
                          {replyAttachments.map((file, index) => (
                            <div
                              key={index}
                              className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg text-sm"
                            >
                              <Paperclip className="w-4 h-4 text-slate-500" />
                              <span className="text-slate-700 max-w-[150px] truncate">
                                {file.name}
                              </span>
                              <button
                                onClick={() =>
                                  setReplyAttachments((prev) =>
                                    prev.filter((_, i) => i !== index),
                                  )
                                }
                                className="text-slate-400 hover:text-red-500"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Hidden File Inputs */}
                      <input
                        type="file"
                        ref={replyFileInputRef}
                        className="hidden"
                        multiple
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          setReplyAttachments((prev) => [...prev, ...files]);
                          if (replyFileInputRef.current)
                            replyFileInputRef.current.value = '';
                        }}
                      />
                      <input
                        type="file"
                        ref={replyImageInputRef}
                        className="hidden"
                        accept="image/*"
                        multiple
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          setReplyAttachments((prev) => [...prev, ...files]);
                          if (replyImageInputRef.current)
                            replyImageInputRef.current.value = '';
                        }}
                      />

                      {/* Action Bar */}
                      <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center gap-2">
                          <Button
                            onClick={() => sendReply()}
                            disabled={replying || !replyForm.body.trim()}
                            className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            {replying ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                            {replying ? 'Sending...' : 'Send'}
                          </Button>
                          <button
                            onClick={() => replyFileInputRef.current?.click()}
                            className="p-2 text-slate-600 hover:bg-slate-100 rounded transition-colors"
                            title="Attach file"
                          >
                            <Paperclip className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => replyImageInputRef.current?.click()}
                            className="p-2 text-slate-600 hover:bg-slate-100 rounded transition-colors"
                            title="Insert image"
                          >
                            <Image className="w-5 h-5" />
                          </button>
                          <div className="relative">
                            <button
                              onClick={() =>
                                setShowEmojiPicker(!showEmojiPicker)
                              }
                              className={cn(
                                'p-2 rounded transition-colors',
                                showEmojiPicker
                                  ? 'bg-slate-200 text-slate-900'
                                  : 'text-slate-600 hover:bg-slate-100',
                              )}
                              title="Insert emoji"
                            >
                              <Smile className="w-5 h-5" />
                            </button>
                            {/* Emoji Picker Dropdown */}
                            {showEmojiPicker && (
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white rounded-xl shadow-xl border border-slate-200 p-2 z-[100] w-[200px]">
                                <div className="grid grid-cols-4 gap-1">
                                  {commonEmojis.map((emoji, index) => (
                                    <button
                                      key={index}
                                      type="button"
                                      onClick={() => {
                                        setReplyForm((prev) => ({
                                          ...prev,
                                          body: prev.body + emoji,
                                        }));
                                        setShowEmojiPicker(false);
                                      }}
                                      className="w-10 h-10 flex items-center justify-center text-2xl hover:bg-slate-100 rounded-lg transition-colors"
                                    >
                                      <span role="img" aria-label="emoji">
                                        {emoji}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setShowInlineReply(false);
                            setReplyAttachments([]);
                            setShowEmojiPicker(false);
                          }}
                          className="p-2 text-slate-600 hover:bg-slate-100 rounded transition-colors"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>

      {/* Reply Email Modal */}
      <Dialog
        open={replyModal.open}
        onOpenChange={(open) => !open && closeReplyModal()}
      >
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-4 border-b border-slate-200">
            <DialogTitle className="text-2xl font-bold text-slate-800">
              Reply to Email
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label className="block text-sm font-semibold text-slate-700 mb-2">
                To
              </Label>
              <Input
                value={replyForm.toEmail}
                onChange={(e) =>
                  setReplyForm({ ...replyForm, toEmail: e.target.value })
                }
                className="w-full px-4 py-3 border-2 border-blue-300 rounded-lg bg-blue-50 text-slate-700 font-medium"
              />
            </div>

            <div>
              <Label className="block text-sm font-semibold text-slate-700 mb-2">
                CC (Optional)
              </Label>
              <Input
                value={replyForm.ccEmail}
                onChange={(e) =>
                  setReplyForm({ ...replyForm, ccEmail: e.target.value })
                }
                placeholder="CC email addresses"
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <Label className="block text-sm font-semibold text-slate-700 mb-2">
                Subject
              </Label>
              <Input
                value={replyForm.subject}
                onChange={(e) =>
                  setReplyForm({ ...replyForm, subject: e.target.value })
                }
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <Label className="block text-sm font-semibold text-slate-700 mb-2">
                Message
              </Label>
              <Textarea
                value={replyForm.body}
                onChange={(e) =>
                  setReplyForm({ ...replyForm, body: e.target.value })
                }
                placeholder="Type your reply here..."
                rows={10}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
            </div>
          </div>

          <DialogFooter className="pt-4 border-t border-slate-200 bg-slate-50 -mx-6 -mb-6 px-6 py-4 rounded-b-2xl flex items-center justify-end space-x-3">
            <Button
              variant="outline"
              onClick={closeReplyModal}
              disabled={replying}
              className="font-medium"
            >
              Cancel
            </Button>
            <Button
              onClick={sendReply}
              disabled={replying || !replyForm.body.trim()}
              className="gap-2 bg-blue-500 hover:bg-blue-600 text-white shadow-md font-medium"
            >
              {replying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Send Reply
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Ticket from Email Modal */}
      <Dialog
        open={ticketModal.open}
        onOpenChange={(open) => !open && closeTicketModal()}
      >
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Ticket from Email</DialogTitle>
            <DialogDescription>
              Create a support ticket from this email. All fields marked with *
              are required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ticket-name">
                  Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="ticket-name"
                  value={ticketForm.name}
                  onChange={(e) => {
                    setTicketForm({ ...ticketForm, name: e.target.value });
                    if (ticketFormErrors.name) {
                      setTicketFormErrors({ ...ticketFormErrors, name: '' });
                    }
                  }}
                  placeholder="Customer name"
                  className={ticketFormErrors.name ? 'border-red-500' : ''}
                />
                {ticketFormErrors.name && (
                  <p className="text-sm text-red-500">
                    {ticketFormErrors.name}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ticket-email">
                  Email <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="ticket-email"
                  type="email"
                  value={ticketForm.email}
                  onChange={(e) => {
                    setTicketForm({ ...ticketForm, email: e.target.value });
                    if (ticketFormErrors.email) {
                      setTicketFormErrors({ ...ticketFormErrors, email: '' });
                    }
                  }}
                  placeholder="customer@example.com"
                  className={ticketFormErrors.email ? 'border-red-500' : ''}
                />
                {ticketFormErrors.email && (
                  <p className="text-sm text-red-500">
                    {ticketFormErrors.email}
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ticket-phone">
                Phone <span className="text-red-500">*</span>
              </Label>
              <Input
                id="ticket-phone"
                value={ticketForm.phone}
                onChange={(e) => {
                  const phoneValue = e.target.value;
                  setTicketForm({ ...ticketForm, phone: phoneValue });
                  if (ticketFormErrors.phone) {
                    setTicketFormErrors({ ...ticketFormErrors, phone: '' });
                  }

                  // Auto-fill Order ID and Tracking ID when phone number is entered (with debounce)
                  if (phoneValue.trim().length >= 10) {
                    // Clear existing timeout
                    if (lookupTimeoutRef.current) {
                      clearTimeout(lookupTimeoutRef.current);
                    }

                    // Set new timeout for debounced lookup
                    lookupTimeoutRef.current = setTimeout(() => {
                      lookupOrderTracking(phoneValue.trim());
                    }, 500); // Wait 500ms after user stops typing
                  }
                }}
                placeholder="+1234567890"
                className={ticketFormErrors.phone ? 'border-red-500' : ''}
              />
              {ticketFormErrors.phone && (
                <p className="text-sm text-red-500">{ticketFormErrors.phone}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ticket-order">
                  Order ID <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="ticket-order"
                  value={ticketForm.order}
                  onChange={(e) => {
                    setTicketForm({ ...ticketForm, order: e.target.value });
                    if (ticketFormErrors.order) {
                      setTicketFormErrors({ ...ticketFormErrors, order: '' });
                    }
                  }}
                  placeholder="Order number"
                  className={ticketFormErrors.order ? 'border-red-500' : ''}
                />
                {ticketFormErrors.order && (
                  <p className="text-sm text-red-500">
                    {ticketFormErrors.order}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ticket-tracking">
                  Tracking ID <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="ticket-tracking"
                  value={ticketForm.trackingId}
                  onChange={(e) => {
                    setTicketForm({
                      ...ticketForm,
                      trackingId: e.target.value,
                    });
                    if (ticketFormErrors.trackingId) {
                      setTicketFormErrors({
                        ...ticketFormErrors,
                        trackingId: '',
                      });
                    }
                  }}
                  placeholder="Tracking number"
                  className={
                    ticketFormErrors.trackingId ? 'border-red-500' : ''
                  }
                />
                {ticketFormErrors.trackingId && (
                  <p className="text-sm text-red-500">
                    {ticketFormErrors.trackingId}
                  </p>
                )}
              </div>
            </div>
            {/* Divider */}
            <div className="border-t border-gray-200 my-4" />

            {/* Issue Details Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 pb-1.5 border-b border-gray-200">
                <div
                  className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'rgba(43, 185, 205, 0.1)' }}
                >
                  <MessageSquare
                    className="w-3.5 h-3.5"
                    style={{ color: '#2bb9cd' }}
                  />
                </div>
                <h3 className="text-sm font-semibold text-gray-900">
                  Issue Details
                </h3>
              </div>

              {/* Category Selection */}
              <div className="space-y-2">
                <Label
                  htmlFor="ticket-category"
                  className="text-xs font-semibold text-gray-700"
                >
                  Category <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={ticketForm.categoryId || undefined}
                  onValueChange={(value) => {
                    setTicketForm({
                      ...ticketForm,
                      categoryId: value || '',
                      subject: '',
                    });
                    if (ticketFormErrors.categoryId) {
                      setTicketFormErrors({
                        ...ticketFormErrors,
                        categoryId: '',
                      });
                    }
                  }}
                >
                  <SelectTrigger
                    id="ticket-category"
                    className={cn(
                      'w-full h-10 text-sm rounded-lg border-2 transition-all duration-200',
                      'focus:outline-none focus:ring-2',
                      ticketFormErrors.categoryId
                        ? 'border-red-300 bg-red-50 focus:border-red-500'
                        : ticketForm.categoryId && !ticketFormErrors.categoryId
                          ? 'border-green-300 bg-green-50 focus:border-green-500'
                          : 'border-gray-200 hover:border-gray-300',
                    )}
                  >
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ticketFormErrors.categoryId && (
                  <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {ticketFormErrors.categoryId}
                  </p>
                )}
              </div>

              {/* Subject */}
              <div className="space-y-2">
                <Label
                  htmlFor="ticket-subject"
                  className="text-xs font-semibold text-gray-700"
                >
                  Subject <span className="text-red-500">*</span>
                </Label>
                {ticketForm.categoryId && getAvailableSubjects().length > 0 ? (
                  <Select
                    value={ticketForm.subject || undefined}
                    onValueChange={(value) => {
                      setTicketForm({ ...ticketForm, subject: value });
                      if (ticketFormErrors.subject) {
                        setTicketFormErrors({
                          ...ticketFormErrors,
                          subject: '',
                        });
                      }
                    }}
                  >
                    <SelectTrigger
                      id="ticket-subject"
                      className={cn(
                        'w-full h-10 text-sm rounded-lg border-2 transition-all duration-200',
                        'focus:outline-none focus:ring-2',
                        ticketFormErrors.subject
                          ? 'border-red-300 bg-red-50 focus:border-red-500'
                          : ticketForm.subject && !ticketFormErrors.subject
                            ? 'border-green-300 bg-green-50 focus:border-green-500'
                            : 'border-gray-200 hover:border-gray-300',
                      )}
                    >
                      <SelectValue placeholder="Select issue type" />
                    </SelectTrigger>
                    <SelectContent>
                      {getAvailableSubjects().map((subject, index) => (
                        <SelectItem
                          key={`${subject}-${index}`}
                          value={String(subject)}
                        >
                          {String(subject)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="ticket-subject"
                    value={ticketForm.subject}
                    onChange={(e) => {
                      setTicketForm({ ...ticketForm, subject: e.target.value });
                      if (ticketFormErrors.subject) {
                        setTicketFormErrors({
                          ...ticketFormErrors,
                          subject: '',
                        });
                      }
                    }}
                    placeholder="Select category first"
                    disabled={!ticketForm.categoryId}
                    className={cn(
                      'w-full h-10 text-sm rounded-lg border-2 transition-all duration-200',
                      'focus:outline-none focus:ring-2',
                      !ticketForm.categoryId
                        ? 'bg-gray-50 cursor-not-allowed'
                        : '',
                      ticketFormErrors.subject
                        ? 'border-red-300 bg-red-50 focus:border-red-500'
                        : ticketForm.subject && !ticketFormErrors.subject
                          ? 'border-green-300 bg-green-50 focus:border-green-500'
                          : 'border-gray-200 hover:border-gray-300',
                    )}
                  />
                )}
                {ticketFormErrors.subject && (
                  <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {ticketFormErrors.subject}
                  </p>
                )}
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label
                  htmlFor="ticket-description"
                  className="text-xs font-semibold text-gray-700"
                >
                  Description <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="ticket-description"
                  value={ticketForm.description}
                  onChange={(e) => {
                    setTicketForm({
                      ...ticketForm,
                      description: e.target.value,
                    });
                    if (ticketFormErrors.description) {
                      setTicketFormErrors({
                        ...ticketFormErrors,
                        description: '',
                      });
                    }
                  }}
                  placeholder="Please provide detailed information about your issue..."
                  rows={3}
                  className={cn(
                    'w-full text-sm rounded-lg border-2 transition-all duration-200 resize-none',
                    'focus:outline-none focus:ring-2',
                    ticketFormErrors.description
                      ? 'border-red-300 bg-red-50 focus:border-red-500'
                      : ticketForm.description && !ticketFormErrors.description
                        ? 'border-green-300 bg-green-50 focus:border-green-500'
                        : 'border-gray-200 hover:border-gray-300',
                  )}
                />
                {ticketFormErrors.description && (
                  <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {ticketFormErrors.description}
                  </p>
                )}
              </div>

              {/* Priority */}
              <div className="space-y-2">
                <Label
                  htmlFor="ticket-priority"
                  className="text-xs font-semibold text-gray-700"
                >
                  Priority
                </Label>
                <Select
                  value={ticketForm.priority}
                  onValueChange={(value) =>
                    setTicketForm({ ...ticketForm, priority: value })
                  }
                >
                  <SelectTrigger
                    id="ticket-priority"
                    className="w-full h-10 text-sm rounded-lg border-2 border-gray-200 hover:border-gray-300 focus:outline-none focus:ring-2"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="NORMAL">Normal</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* File Upload */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-gray-700">
                  Attachments{' '}
                  {requiresAttachments() ? (
                    <span className="text-red-500">*</span>
                  ) : (
                    <span className="text-gray-400">(Optional)</span>
                  )}
                </Label>
                {requiresAttachments() && (
                  <p className="text-xs text-gray-600">
                    Images or videos are required for this category
                  </p>
                )}
                {ticketFormErrors.attachments && (
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{ticketFormErrors.attachments}</span>
                  </p>
                )}

                {/* First Row: Single Video Upload Card */}
                <div className="mb-2">
                  <label className="cursor-pointer block">
                    <input
                      type="file"
                      ref={singleFileInputRef}
                      accept="video/*"
                      onChange={handleSingleFileSelect}
                      className="hidden"
                      disabled={!!singleFile}
                    />
                    <div
                      className={cn(
                        'border-2 border-dashed rounded-lg p-3 text-center transition-all duration-200',
                        singleFile
                          ? 'border-green-300 bg-green-50'
                          : requiresAttachments() && !singleFile
                            ? 'border-red-300 bg-red-50 hover:border-red-400'
                            : 'border-gray-300 hover:border-gray-400',
                      )}
                      onMouseEnter={(e) => {
                        if (!singleFile && !requiresAttachments()) {
                          e.currentTarget.style.borderColor = '#2bb9cd';
                          e.currentTarget.style.backgroundColor =
                            'rgba(43, 185, 205, 0.05)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!singleFile && !requiresAttachments()) {
                          e.currentTarget.style.borderColor = '';
                          e.currentTarget.style.backgroundColor = '';
                        }
                      }}
                    >
                      {singleFile ? (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                              <FileText className="w-5 h-5 text-green-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-gray-900 truncate">
                                {singleFile.name}
                              </p>
                              <p className="text-[10px] text-gray-500">
                                {formatFileSize(singleFile.size)}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleRemoveSingleFile();
                            }}
                            className="flex-shrink-0 p-1.5 hover:bg-red-100 active:bg-red-200 rounded-lg transition-colors"
                            aria-label="Remove video"
                          >
                            <X className="w-4 h-4 text-red-600" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div
                            className="inline-flex items-center justify-center w-10 h-10 rounded-full mb-2"
                            style={{
                              backgroundColor: 'rgba(43, 185, 205, 0.1)',
                            }}
                          >
                            <Upload
                              className="w-5 h-5"
                              style={{ color: '#2bb9cd' }}
                            />
                          </div>
                          <p className="text-xs font-medium text-gray-900 mb-1">
                            Tap to upload video
                          </p>
                          <p className="text-[10px] text-gray-500 px-2">
                            Video files only, 10MB max
                          </p>
                        </>
                      )}
                    </div>
                  </label>
                </div>

                {/* Second Row: Three Image Upload Cards */}
                <div className="grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((index) => (
                    <div key={index}>
                      <label className="cursor-pointer block">
                        <input
                          type="file"
                          ref={imageFileInputRefs[index]}
                          accept="image/*"
                          onChange={handleImageFileSelect(index)}
                          className="hidden"
                          disabled={!!imageFiles[index]}
                        />
                        <div
                          className={cn(
                            'border-2 border-dashed rounded-lg p-1.5 text-center transition-all duration-200 h-20',
                            imageFiles[index]
                              ? 'border-green-300 bg-green-50'
                              : requiresAttachments() &&
                                  !imageFiles[index] &&
                                  !singleFile &&
                                  imageFiles.every((f) => !f)
                                ? 'border-red-300 bg-red-50 hover:border-red-400'
                                : 'border-gray-300 hover:border-gray-400',
                          )}
                          onMouseEnter={(e) => {
                            if (!imageFiles[index] && !requiresAttachments()) {
                              e.currentTarget.style.borderColor = '#2bb9cd';
                              e.currentTarget.style.backgroundColor =
                                'rgba(43, 185, 205, 0.05)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!imageFiles[index] && !requiresAttachments()) {
                              e.currentTarget.style.borderColor = '';
                              e.currentTarget.style.backgroundColor = '';
                            }
                          }}
                        >
                          {imageFiles[index] ? (
                            <div className="h-full flex flex-col">
                              <div className="flex-1 flex items-center justify-center mb-1">
                                <div className="w-6 h-6 bg-green-100 rounded-lg flex items-center justify-center">
                                  <FileText className="w-3.5 h-3.5 text-green-600" />
                                </div>
                              </div>
                              <div className="flex-1 flex flex-col justify-end">
                                <p className="text-[9px] font-medium text-gray-900 truncate mb-0.5">
                                  {imageFiles[index]?.name}
                                </p>
                                <p className="text-[8px] text-gray-500 mb-1">
                                  {imageFiles[index] &&
                                    formatFileSize(imageFiles[index].size)}
                                </p>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleRemoveImageFile(index);
                                  }}
                                  className="mx-auto p-0.5 hover:bg-red-100 active:bg-red-200 rounded transition-colors"
                                  aria-label="Remove image"
                                >
                                  <X className="w-3 h-3 text-red-600" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="h-full flex flex-col items-center justify-center">
                              <Upload className="w-4 h-4 text-gray-400 mb-1" />
                              <p className="text-[9px] text-gray-500">Image</p>
                            </div>
                          )}
                        </div>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeTicketModal}
              disabled={creatingTicket}
            >
              Cancel
            </Button>
            <Button
              onClick={createTicketFromEmail}
              disabled={creatingTicket}
              className="gap-2"
            >
              {creatingTicket ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Create Ticket
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ ...deleteDialog, open })}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <DialogTitle className="text-xl font-semibold text-gray-900">
                Confirm Deletion
              </DialogTitle>
            </div>
            <DialogDescription className="text-base text-gray-600 pt-2">
              {deleteDialog.type === 'all' ? (
                <>
                  Are you sure you want to delete{' '}
                  <strong>all {deleteDialog.count} email(s)</strong>?
                  <br />
                  <span className="text-red-600 font-medium mt-2 block">
                    This action cannot be undone.
                  </span>
                </>
              ) : (
                <>
                  Are you sure you want to delete{' '}
                  <strong>{deleteDialog.count} selected email(s)</strong>?
                  <br />
                  <span className="text-red-600 font-medium mt-2 block">
                    This action cannot be undone.
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() =>
                setDeleteDialog({ open: false, type: 'selected', count: 0 })
              }
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={
                deleteDialog.type === 'all'
                  ? confirmDeleteAll
                  : confirmDeleteSelected
              }
              disabled={deleting}
              className="gap-2"
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  Delete {deleteDialog.type === 'all' ? 'All' : 'Selected'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

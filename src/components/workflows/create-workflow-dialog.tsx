'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createWorkflow } from '@/lib/workflow-actions';
import { toErrorMessage } from '@/lib/utils';

interface CreateWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Creates an empty workflow and drops the user straight onto its canvas. */
export function CreateWorkflowDialog({ open, onOpenChange }: CreateWorkflowDialogProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    try {
      const workflow = await createWorkflow({
        name: name.trim(),
        description: description.trim(),
        tags: tags
          .split(',')
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean),
      });

      toast.success('Workflow created.');
      onOpenChange(false);
      setName('');
      setDescription('');
      setTags('');
      router.push(`/workflows/${workflow.id}`);
    } catch (error) {
      toast.error(toErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
            <DialogDescription>
              Start from an empty canvas. You can drag agents in once it opens.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="workflow-name">Name</Label>
              <Input
                id="workflow-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Contract risk review"
                maxLength={120}
                autoFocus
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="workflow-description">Description</Label>
              <Textarea
                id="workflow-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this workflow is for, and what a good run produces."
                maxLength={1_000}
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="workflow-tags">Tags</Label>
              <Input
                id="workflow-tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="legal, review, compliance"
              />
              <p className="text-xs text-muted-foreground">Comma separated.</p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!name.trim()}>
              Create workflow
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

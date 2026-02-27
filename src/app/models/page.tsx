'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Cpu, Plus, Trash2, Save, ArrowLeft, Edit2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';

interface ModelOption {
  value: string;
  label: string;
  costMultiplier: number;
}

export default function ModelsPage() {
  const router = useRouter();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [newModel, setNewModel] = useState<ModelOption>({
    value: '',
    label: '',
    costMultiplier: 0.1,
  });

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/models');
      const data = await response.json();
      setModels(data.models || []);
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveModels = async () => {
    try {
      setSaving(true);
      const response = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models }),
      });

      if (response.ok) {
        alert('Models saved successfully!');
      } else {
        alert('Failed to save models');
      }
    } catch (error) {
      console.error('Failed to save models:', error);
      alert('Failed to save models');
    } finally {
      setSaving(false);
    }
  };

  const addModel = () => {
    if (!newModel.value || !newModel.label) {
      alert('Please fill in all fields');
      return;
    }
    setModels([...models, { ...newModel }]);
    setNewModel({ value: '', label: '', costMultiplier: 0.1 });
  };

  const deleteModel = (index: number) => {
    if (confirm('Are you sure you want to delete this model?')) {
      setModels(models.filter((_, i) => i !== index));
    }
  };

  const updateModel = (index: number, field: keyof ModelOption, value: string | number) => {
    const updated = [...models];
    updated[index] = { ...updated[index], [field]: value };
    setModels(updated);
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Animated background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="relative z-10">
        {/* Header */}
        <motion.header
          initial={{ y: -100 }}
          animate={{ y: 0 }}
          className="border-b border-border/50 bg-card/30 backdrop-blur-xl sticky top-0 z-50"
        >
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" onClick={() => router.push('/')}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gradient-to-br from-primary to-blue-600 rounded-lg">
                    <Cpu className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
                      Model Management
                    </h1>
                    <p className="text-xs text-muted-foreground">Configure AI model options</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <LanguageToggle />
                <ThemeToggle />
                <Button onClick={saveModels} disabled={saving}>
                  <Save className="w-4 h-4 mr-2" />
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          </div>
        </motion.header>

        <div className="container mx-auto px-6 py-8 space-y-8">
          {/* Add New Model */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-6"
          >
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              Add New Model
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="value">Model Value</Label>
                <Input
                  id="value"
                  placeholder="e.g., claude-opus-4-6"
                  value={newModel.value}
                  onChange={(e) => setNewModel({ ...newModel, value: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="label">Display Label</Label>
                <Input
                  id="label"
                  placeholder="e.g., Claude Opus 4.6"
                  value={newModel.label}
                  onChange={(e) => setNewModel({ ...newModel, label: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="cost">Cost Multiplier</Label>
                <Input
                  id="cost"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 0.3"
                  value={newModel.costMultiplier}
                  onChange={(e) => setNewModel({ ...newModel, costMultiplier: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="flex items-end">
                <Button onClick={addModel} className="w-full">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Model
                </Button>
              </div>
            </div>
          </motion.div>

          {/* Models List */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-6"
          >
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Cpu className="w-5 h-5 text-primary" />
              Configured Models ({models.length})
            </h2>
            <div className="space-y-3">
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">Loading models...</div>
              ) : models.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No models configured</div>
              ) : (
                models.map((model, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 + index * 0.05 }}
                    className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg border border-border/30"
                  >
                    {editingIndex === index ? (
                      <>
                        <div className="flex-1 grid grid-cols-3 gap-3">
                          <Input
                            value={model.value}
                            onChange={(e) => updateModel(index, 'value', e.target.value)}
                            placeholder="Model value"
                          />
                          <Input
                            value={model.label}
                            onChange={(e) => updateModel(index, 'label', e.target.value)}
                            placeholder="Display label"
                          />
                          <Input
                            type="number"
                            step="0.01"
                            value={model.costMultiplier}
                            onChange={(e) => updateModel(index, 'costMultiplier', parseFloat(e.target.value) || 0)}
                            placeholder="Cost multiplier"
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingIndex(null)}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="flex-1 grid grid-cols-3 gap-4">
                          <div>
                            <div className="text-xs text-muted-foreground">Value</div>
                            <div className="font-mono text-sm">{model.value}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Label</div>
                            <div className="font-medium">{model.label}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Cost Multiplier</div>
                            <div className="font-medium">{model.costMultiplier}</div>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingIndex(index)}
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteModel(index)}
                          className="text-red-500 hover:text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

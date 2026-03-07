"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import api from "@/lib/api";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface EditUserDialogProps {
  user: User | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  isSelf: boolean;
}

export function EditUserDialog({ user, open, onOpenChange, onSaved, isSelf }: EditUserDialogProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("analyst");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
      setRole(user.role);
      setPassword("");
      setShowPassword(false);
      setError("");
    }
  }, [user]);

  const generatePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";
    const arr = new Uint32Array(16);
    crypto.getRandomValues(arr);
    setPassword(Array.from(arr, (v) => chars[v % chars.length]).join(""));
    setShowPassword(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError("");
    setLoading(true);

    try {
      const body: Record<string, string> = {};
      if (name.trim() !== user.name) body.name = name.trim();
      if (email.trim() !== user.email) body.email = email.trim();
      if (role !== user.role) body.role = role;
      if (password.trim()) body.password = password.trim();

      if (Object.keys(body).length === 0) {
        onOpenChange(false);
        return;
      }

      await api.patch(`/users/${user.id}`, body);
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>
            Update user details{isSelf ? " (your account)" : ""}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">
              {error}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-email">Email</Label>
            <Input
              id="edit-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-role">Role</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRole("analyst")}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  role === "analyst"
                    ? "border-primary text-primary bg-primary/10"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                Analyst
              </button>
              <button
                type="button"
                onClick={() => setRole("admin")}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  role === "admin"
                    ? "border-primary text-primary bg-primary/10"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                Admin
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-password">New Password</Label>
            <p className="text-[11px] text-muted-foreground">Leave blank to keep current password.</p>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Input
                  id="edit-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  className="pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={generatePassword}
                title="Generate random password"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading || !name.trim() || !email.trim()}>
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

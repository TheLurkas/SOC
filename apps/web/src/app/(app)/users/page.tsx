"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateUserDialog } from "@/components/create-user-dialog";
import { EditUserDialog } from "@/components/edit-user-dialog";
import { Pencil, Trash2 } from "lucide-react";
import api from "@/lib/api";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

export default function UsersPage() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const fetchUsers = async () => {
    try {
      const { data: json } = await api.get("/users");
      setUsers(json.data);
    } catch (err: any) {
      if (err.response?.status === 403) {
        router.push("/dashboard");
        return;
      }
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const deleteUser = async (id: string, name: string) => {
    if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/users/${id}`);
      await fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Users</h1>
          <p className="text-xs text-muted-foreground">
            {users.length} users
          </p>
        </div>
        <CreateUserDialog onCreated={fetchUsers} />
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Email</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Role</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Created</th>
              <th className="w-20 px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = session?.user?.id === user.id;

              return (
                <tr key={user.id} className="border-b border-border last:border-0 hover:bg-secondary/10 transition-colors">
                  <td className="px-4 py-3">
                    {user.name}
                    {isSelf && <span className="text-muted-foreground ml-1.5 text-xs">(You)</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className={
                        user.role === "admin"
                          ? "text-primary border-primary/30"
                          : "text-muted-foreground border-border"
                      }
                    >
                      {user.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => setEditingUser(user)}
                        title="Edit user"
                      >
                        <Pencil className="size-3 text-muted-foreground" />
                      </Button>
                      {!isSelf && (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => deleteUser(user.id, user.name)}
                          title="Delete user"
                        >
                          <Trash2 className="size-3 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <EditUserDialog
        user={editingUser}
        open={!!editingUser}
        onOpenChange={(open) => { if (!open) setEditingUser(null); }}
        onSaved={fetchUsers}
        isSelf={editingUser?.id === session?.user?.id}
      />
    </div>
  );
}

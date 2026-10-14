import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const inspirations = sqliteTable(
  'inspirations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    sourceUrl: text('source_url'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    summary: text('summary').notNull().default(''),
    primaryTag: text('primary_tag').notNull().default('人像'),
    tags: text('tags').notNull().default('[]'),
    status: text('status').notNull().default('ready'),
    coverKey: text('cover_key'),
    coverType: text('cover_type'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_inspirations_user_created').on(table.userId, table.createdAt),
    uniqueIndex('idx_inspirations_user_source').on(table.userId, table.sourceUrl),
  ],
);

export const inspirationImages = sqliteTable(
  'inspiration_images',
  {
    id: text('id').primaryKey(),
    inspirationId: text('inspiration_id').notNull(),
    userId: text('user_id').notNull(),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_images_inspiration').on(table.inspirationId, table.position),
    index('idx_images_user').on(table.userId),
  ],
);

export const shootProjects = sqliteTable(
  'shoot_projects',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('idx_projects_user_created').on(table.userId, table.createdAt)],
);

export const projectItems = sqliteTable(
  'project_items',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    inspirationId: text('inspiration_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_project_items_project').on(table.projectId),
    uniqueIndex('idx_project_items_unique').on(table.projectId, table.inspirationId),
  ],
);

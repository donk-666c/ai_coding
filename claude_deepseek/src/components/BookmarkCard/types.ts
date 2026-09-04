/**
 * BookmarkCard 组件的 Props 类型定义
 */

export interface BookmarkCardProps {
  /** 书签标题 */
  title: string;
  /** 书签 URL */
  url: string;
  /** 书签描述（可选） */
  description?: string;
  /** 标签列表（可选） */
  tags?: string[];
}

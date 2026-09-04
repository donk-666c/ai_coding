/**
 * BookmarkCard 组件测试
 * 使用 @testing-library/react
 */
import { render, screen } from '@testing-library/react';
import { BookmarkCard } from './index';

describe('BookmarkCard', () => {
  const defaultProps = {
    title: 'Claude Code 文档',
    url: 'https://docs.anthropic.com/claude-code',
    description: 'Claude Code 官方使用文档',
    tags: ['AI', '文档', '开发工具'],
  };

  it('渲染标题、URL、描述和标签', () => {
    render(<BookmarkCard {...defaultProps} />);

    expect(screen.getByRole('link', { name: defaultProps.title })).toHaveAttribute(
      'href',
      defaultProps.url,
    );
    expect(screen.getByText(defaultProps.url)).toBeInTheDocument();
    expect(screen.getByText(defaultProps.description!)).toBeInTheDocument();
    defaultProps.tags!.forEach((tag) => {
      expect(screen.getByText(tag)).toBeInTheDocument();
    });
  });

  it('description 和 tags 未传时不渲染对应区域', () => {
    render(<BookmarkCard title={defaultProps.title} url={defaultProps.url} />);

    expect(screen.getByRole('link', { name: defaultProps.title })).toBeInTheDocument();
    expect(screen.queryByText(defaultProps.description!)).not.toBeInTheDocument();
    expect(screen.queryByText(defaultProps.tags![0])).not.toBeInTheDocument();
  });
});

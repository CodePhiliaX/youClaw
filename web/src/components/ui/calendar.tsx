import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  DayButton as DayPickerDayButton,
  DayPicker,
  NextMonthButton as DayPickerNextMonthButton,
  PreviousMonthButton as DayPickerPreviousMonthButton,
  type DayButtonProps,
  type DayPickerProps,
} from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = DayPickerProps & {
  dayButtonTestIdPrefix?: string
}

function CalendarDayButton({
  dayButtonTestIdPrefix,
  ...props
}: DayButtonProps & { dayButtonTestIdPrefix?: string }) {
  return (
    <DayPickerDayButton
      data-testid={dayButtonTestIdPrefix ? `${dayButtonTestIdPrefix}-${props.day.isoDate}` : undefined}
      {...props}
    />
  )
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  dayButtonTestIdPrefix,
  components,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        root: "w-fit",
        months: "flex flex-col",
        month: "space-y-4",
        month_caption: "relative flex h-8 items-center justify-center px-8",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "outline", size: "icon-sm" }),
          "h-8 w-8 bg-transparent p-0 text-muted-foreground hover:text-foreground"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline", size: "icon-sm" }),
          "h-8 w-8 bg-transparent p-0 text-muted-foreground hover:text-foreground"
        ),
        weekdays: "flex w-full",
        weekday: "w-9 text-[0.8rem] font-normal text-muted-foreground",
        week: "mt-2 flex w-full",
        day: "h-9 w-9 p-0 text-center text-sm",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100"
        ),
        today: "text-primary",
        selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        outside: "text-muted-foreground opacity-50",
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName, ...chevronProps }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("h-4 w-4", chevronClassName)} {...chevronProps} />
          ) : (
            <ChevronRight className={cn("h-4 w-4", chevronClassName)} {...chevronProps} />
          ),
        DayButton: (dayButtonProps) => (
          <CalendarDayButton
            dayButtonTestIdPrefix={dayButtonTestIdPrefix}
            {...dayButtonProps}
          />
        ),
        PreviousMonthButton: (buttonProps) => (
          <DayPickerPreviousMonthButton
            data-testid="calendar-previous-month"
            {...buttonProps}
          />
        ),
        NextMonthButton: (buttonProps) => (
          <DayPickerNextMonthButton
            data-testid="calendar-next-month"
            {...buttonProps}
          />
        ),
        ...components,
      }}
      {...props}
    />
  )
}

export { Calendar }

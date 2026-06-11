"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { FilterHorizontalIcon } from "@hugeicons/core-free-icons"

import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuCheckboxItem,
} from "@/components/ui/cubby-ui/dropdown-menu"
import { Button } from "@/components/ui/cubby-ui/button"
import { useDataTable } from "@/components/ui/cubby-ui/data-table/data-table-context"

function DataTableColumnToggle() {
	const { table } = useDataTable()

	const toggleableColumns = table
		.getAllColumns()
		.filter((col) => col.id !== "__select__" && col.getCanHide())

	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="ghost" size="icon_sm" />}>
				<HugeiconsIcon
					icon={FilterHorizontalIcon}
					className="size-4"
					strokeWidth={2}
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="bottom" align="end">
				<DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
				{toggleableColumns.map((column) => {
					const label =
						typeof column.columnDef.header === "string"
							? column.columnDef.header
							: column.id

					return (
						<DropdownMenuCheckboxItem
							key={column.id}
							checked={column.getIsVisible()}
							onCheckedChange={(checked) =>
								column.toggleVisibility(!!checked)
							}
						>
							{label}
						</DropdownMenuCheckboxItem>
					)
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

export { DataTableColumnToggle }
